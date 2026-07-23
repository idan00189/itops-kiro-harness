import {
  BSON,
  MongoClient,
  type Document,
  type MongoClientOptions,
} from "mongodb";
import { z } from "zod";
import {
  filterVisibleMongoDatabases,
  loadMongoProfiles,
  resolveConnection,
  resolveMongoDatabase,
  type MongoConnectionProfile,
} from "../common/database-profiles.js";
import {
  assertMongoCollectionScopes,
  assertReadOnlyPipeline,
  assertSafeIdentifier,
  assertSafeMongoValue,
  matchesAllowlist,
} from "../common/guards.js";
import { enabled, envInteger } from "../common/env.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";

const SERVER = "itops-mongodb-docdb";
const server = createServer(
  SERVER,
  "Named MongoDB and Amazon DocumentDB connections with authorized-database discovery and bounded read-only queries. System databases and write operations are blocked.",
);

let profilesCache: MongoConnectionProfile[] | undefined;
const clientPromises = new Map<string, Promise<MongoClient>>();

function assertEnabled(): void {
  if (!enabled("MONGODB")) throw new Error("MongoDB/DocumentDB integration is disabled");
}

function profiles(): MongoConnectionProfile[] {
  assertEnabled();
  profilesCache ??= loadMongoProfiles();
  return profilesCache;
}

function clientOptions(profile: MongoConnectionProfile): MongoClientOptions {
  return {
    appName: `itops-readonly-${profile.name}`,
    readPreference: profile.readPreference,
    retryWrites: false,
    maxPoolSize: envInteger("MONGODB_POOL_MAX", 4, 1, 20),
    minPoolSize: 0,
    maxIdleTimeMS: 30_000,
    serverSelectionTimeoutMS: envInteger(
      "MONGODB_CONNECT_TIMEOUT_MS",
      15_000,
      1_000,
      120_000,
    ),
    connectTimeoutMS: envInteger(
      "MONGODB_CONNECT_TIMEOUT_MS",
      15_000,
      1_000,
      120_000,
    ),
    socketTimeoutMS: envInteger(
      "MONGODB_QUERY_TIMEOUT_MS",
      30_000,
      1_000,
      300_000,
    ),
    ...(profile.tlsCaFile ? { tls: true, tlsCAFile: profile.tlsCaFile } : {}),
    ...(profile.mode === "documentdb" ? { directConnection: false } : {}),
  };
}

function getClient(profile: MongoConnectionProfile): Promise<MongoClient> {
  let clientPromise = clientPromises.get(profile.name);
  if (!clientPromise) {
    const client = new MongoClient(profile.uri, clientOptions(profile));
    clientPromise = client.connect().catch((error) => {
      clientPromises.delete(profile.name);
      throw error;
    });
    clientPromises.set(profile.name, clientPromise);
  }
  return clientPromise;
}

function assertCollection(
  profile: MongoConnectionProfile,
  collection: string,
): string {
  const safe = assertSafeIdentifier(collection, "MongoDB collection");
  if (!matchesAllowlist(safe, profile.collectionAllowlist)) {
    throw new Error(
      `Collection ${safe} is outside connection ${profile.name} collection allowlist`,
    );
  }
  return safe;
}

function asJson(value: unknown): unknown {
  return JSON.parse(BSON.EJSON.stringify(value, { relaxed: true })) as unknown;
}

async function listVisibleDatabases(
  profile: MongoConnectionProfile,
): Promise<string[]> {
  const client = await getClient(profile);
  const result = await client.db("admin").admin().listDatabases({
    nameOnly: true,
    authorizedDatabases: true,
    maxTimeMS: envInteger(
      "MONGODB_QUERY_TIMEOUT_MS",
      30_000,
      1_000,
      300_000,
    ),
  });
  return filterVisibleMongoDatabases(
    profile,
    result.databases.map((database) => database.name),
  );
}

server.registerTool(
  "mongodb_list_connections",
  {
    title: "List MongoDB/DocumentDB connections",
    description:
      "List safe metadata for configured named connections. URIs, credentials, and hostnames are never returned.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "mongodb_list_connections", input, async () => ({
      connections: profiles().map((profile) => ({
        name: profile.name,
        mode: profile.mode,
        readPreference: profile.readPreference,
        databaseAllowlist: profile.databaseAllowlist,
        collectionAllowlist: profile.collectionAllowlist,
        tlsCaConfigured: Boolean(profile.tlsCaFile),
      })),
    })),
);

server.registerTool(
  "mongodb_list_databases",
  {
    title: "List authorized MongoDB/DocumentDB databases",
    description:
      "List non-system databases visible to one or every configured read-only identity, filtered by each connection's database allowlist.",
    inputSchema: z.object({
      connection: z.string().min(1).max(32).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "mongodb_list_databases", input, async () => {
      const selected = input.connection
        ? [resolveConnection(profiles(), input.connection, "MongoDB/DocumentDB")]
        : profiles();
      const connections = [];
      for (const profile of selected) {
        connections.push({
          connection: profile.name,
          mode: profile.mode,
          databases: await listVisibleDatabases(profile),
        });
      }
      return { connections };
    }),
);

server.registerTool(
  "mongodb_find",
  {
    title: "Find MongoDB/DocumentDB documents (read-only)",
    description:
      "Run a bounded find on a named connection and authorized database. Server-side JavaScript and all write operators are rejected.",
    inputSchema: z.object({
      connection: z.string().min(1).max(32).optional(),
      database: z.string().min(1).max(128).optional(),
      collection: z.string().min(1).max(128),
      filter: z.record(z.string(), z.unknown()).default({}),
      projection: z
        .record(z.string(), z.union([z.literal(0), z.literal(1)]))
        .optional(),
      sort: z.record(z.string(), z.union([z.literal(1), z.literal(-1)])).optional(),
      limit: z.number().int().min(1).max(2_000).default(100),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(
      SERVER,
      "mongodb_find",
      {
        connection: input.connection,
        database: input.database,
        collection: input.collection,
        filter: input.filter,
      },
      async () => {
        assertSafeMongoValue(input.filter);
        if (input.projection) assertSafeMongoValue(input.projection);
        if (input.sort) assertSafeMongoValue(input.sort);
        const profile = resolveConnection(
          profiles(),
          input.connection,
          "MongoDB/DocumentDB",
        );
        const database = resolveMongoDatabase(profile, input.database);
        const client = await getClient(profile);
        const limit = Math.min(
          input.limit,
          envInteger("MONGODB_MAX_DOCUMENTS", 500, 1, 10_000),
        );
        let cursor = client
          .db(database)
          .collection(assertCollection(profile, input.collection))
          .find(input.filter as Document, {
            maxTimeMS: envInteger(
              "MONGODB_QUERY_TIMEOUT_MS",
              30_000,
              1_000,
              300_000,
            ),
          })
          .limit(limit);
        if (input.projection) cursor = cursor.project(input.projection);
        if (input.sort) cursor = cursor.sort(input.sort);
        const documents = await cursor.toArray();
        return {
          connection: profile.name,
          database,
          documents: asJson(documents),
          count: documents.length,
          truncated: documents.length >= limit,
        };
      },
    ),
);

server.registerTool(
  "mongodb_aggregate",
  {
    title: "Aggregate MongoDB/DocumentDB data (read-only)",
    description:
      "Run an aggregation on a named connection and authorized database using only allowlisted read stages.",
    inputSchema: z.object({
      connection: z.string().min(1).max(32).optional(),
      database: z.string().min(1).max(128).optional(),
      collection: z.string().min(1).max(128),
      pipeline: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
      maxDocuments: z.number().int().min(1).max(2_000).default(200),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(
      SERVER,
      "mongodb_aggregate",
      {
        connection: input.connection,
        database: input.database,
        collection: input.collection,
        pipeline: input.pipeline,
      },
      async () => {
        assertReadOnlyPipeline(input.pipeline);
        const profile = resolveConnection(
          profiles(),
          input.connection,
          "MongoDB/DocumentDB",
        );
        assertMongoCollectionScopes(input.pipeline, profile.collectionAllowlist);
        const database = resolveMongoDatabase(profile, input.database);
        const limit = Math.min(
          input.maxDocuments,
          envInteger("MONGODB_MAX_DOCUMENTS", 500, 1, 10_000),
        );
        const pipeline = [...input.pipeline, { $limit: limit }] as Document[];
        const client = await getClient(profile);
        const documents = await client
          .db(database)
          .collection(assertCollection(profile, input.collection))
          .aggregate(pipeline, {
            allowDiskUse: false,
            maxTimeMS: envInteger(
              "MONGODB_QUERY_TIMEOUT_MS",
              30_000,
              1_000,
              300_000,
            ),
          })
          .toArray();
        return {
          connection: profile.name,
          database,
          documents: asJson(documents),
          count: documents.length,
          truncated: documents.length >= limit,
        };
      },
    ),
);

server.registerTool(
  "mongodb_list_collections",
  {
    title: "List visible MongoDB/DocumentDB collections",
    description:
      "List allowlisted collection names in one authorized database on a named connection.",
    inputSchema: z.object({
      connection: z.string().min(1).max(32).optional(),
      database: z.string().min(1).max(128).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "mongodb_list_collections", input, async () => {
      const profile = resolveConnection(
        profiles(),
        input.connection,
        "MongoDB/DocumentDB",
      );
      const database = resolveMongoDatabase(profile, input.database);
      const client = await getClient(profile);
      const collections = await client
        .db(database)
        .listCollections({}, { nameOnly: true })
        .toArray();
      return {
        connection: profile.name,
        database,
        collections: collections
          .map((item) => item.name)
          .filter((name) => matchesAllowlist(name, profile.collectionAllowlist))
          .sort(),
      };
    }),
);

server.registerTool(
  "mongodb_sample_schema",
  {
    title: "Sample MongoDB/DocumentDB document shape",
    description:
      "Return a small read-only sample from one authorized database to infer field names and BSON types.",
    inputSchema: z.object({
      connection: z.string().min(1).max(32).optional(),
      database: z.string().min(1).max(128).optional(),
      collection: z.string().min(1).max(128),
      sampleSize: z.number().int().min(1).max(20).default(5),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "mongodb_sample_schema", input, async () => {
      const profile = resolveConnection(
        profiles(),
        input.connection,
        "MongoDB/DocumentDB",
      );
      const database = resolveMongoDatabase(profile, input.database);
      const client = await getClient(profile);
      const documents = await client
        .db(database)
        .collection(assertCollection(profile, input.collection))
        .find(
          {},
          {
            maxTimeMS: envInteger(
              "MONGODB_QUERY_TIMEOUT_MS",
              30_000,
              1_000,
              300_000,
            ),
          },
        )
        .limit(input.sampleSize)
        .toArray();
      return {
        connection: profile.name,
        database,
        documents: asJson(documents),
      };
    }),
);

server.registerTool(
  "mongodb_health",
  {
    title: "Check MongoDB/DocumentDB read connections",
    description:
      "Ping one or every named connection and discover its authorized, non-system databases without modifying data.",
    inputSchema: z.object({
      connection: z.string().min(1).max(32).optional(),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "mongodb_health", input, async () => {
      if (!enabled("MONGODB")) {
        return { status: "disabled", integration: "mongodb" };
      }
      const selected = input.connection
        ? [resolveConnection(profiles(), input.connection, "MongoDB/DocumentDB")]
        : profiles();
      const connections = [];
      for (const profile of selected) {
        const client = await getClient(profile);
        const ping = await client.db("admin").command({ ping: 1 });
        const databases = await listVisibleDatabases(profile);
        if (databases.length === 0) {
          throw new Error(
            `MongoDB/DocumentDB connection ${profile.name} has no authorized non-system databases inside its allowlist`,
          );
        }
        connections.push({
          name: profile.name,
          mode: profile.mode,
          readPreference: profile.readPreference,
          databases,
          ping: asJson(ping),
          tlsCaConfigured: Boolean(profile.tlsCaFile),
        });
      }
      return { status: "ok", connections };
    }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all(
      [...clientPromises.values()].map((clientPromise) =>
        clientPromise.then((client) => client.close()).catch(() => undefined),
      ),
    ).finally(() => process.exit(0));
  });
}

await startServer(server);
