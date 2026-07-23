import {
  BSON,
  MongoClient,
  type Document,
  type MongoClientOptions,
  type ReadPreferenceMode,
} from "mongodb";
import { z } from "zod";
import {
  assertReadOnlyPipeline,
  assertSafeIdentifier,
  assertSafeMongoValue,
  assertMongoCollectionScopes,
  matchesAllowlist,
} from "../common/guards.js";
import { enabled, env, envCsv, envInteger } from "../common/env.js";
import { createServer, readOnlyAnnotations, runTool, startServer } from "../common/mcp.js";

const SERVER = "itops-mongodb-docdb";
const server = createServer(
  SERVER,
  "Bounded read-only MongoDB and Amazon DocumentDB queries. Only find, allowlisted aggregation stages, schema samples, collection listing, and ping are exposed.",
);

let clientPromise: Promise<MongoClient> | undefined;

function assertEnabled(): void {
  if (!enabled("MONGODB")) throw new Error("MongoDB/DocumentDB integration is disabled");
}

function readPreference(): ReadPreferenceMode {
  const value = env("MONGODB_READ_PREFERENCE", {
    defaultValue: "secondaryPreferred",
    allowPlaceholder: true,
  });
  const allowed: ReadPreferenceMode[] = [
    "primary",
    "primaryPreferred",
    "secondary",
    "secondaryPreferred",
    "nearest",
  ];
  if (!allowed.includes(value as ReadPreferenceMode)) {
    throw new Error("MONGODB_READ_PREFERENCE is invalid");
  }
  return value as ReadPreferenceMode;
}

function getClient(): Promise<MongoClient> {
  assertEnabled();
  if (!clientPromise) {
    const mode = env("MONGODB_MODE", { defaultValue: "mongodb", allowPlaceholder: true }).toLowerCase();
    if (!["mongodb", "documentdb"].includes(mode)) {
      throw new Error("MONGODB_MODE must be mongodb or documentdb");
    }
    const options: MongoClientOptions = {
      appName: "itops-readonly",
      readPreference: readPreference(),
      retryWrites: false,
      maxPoolSize: envInteger("MONGODB_POOL_MAX", 4, 1, 20),
      minPoolSize: 0,
      maxIdleTimeMS: 30_000,
      serverSelectionTimeoutMS: envInteger("MONGODB_CONNECT_TIMEOUT_MS", 15_000, 1_000, 120_000),
      connectTimeoutMS: envInteger("MONGODB_CONNECT_TIMEOUT_MS", 15_000, 1_000, 120_000),
      socketTimeoutMS: envInteger("MONGODB_QUERY_TIMEOUT_MS", 30_000, 1_000, 300_000),
      ...(env("MONGODB_TLS_CA_FILE", { allowPlaceholder: true })
        ? { tls: true, tlsCAFile: env("MONGODB_TLS_CA_FILE") }
        : {}),
      ...(mode === "documentdb" ? { directConnection: false } : {}),
    };
    const client = new MongoClient(env("MONGODB_URI", { required: true }), options);
    clientPromise = client.connect();
  }
  return clientPromise;
}

function databaseName(): string {
  return assertSafeIdentifier(env("MONGODB_DATABASE", { required: true }), "MongoDB database");
}

function assertCollection(collection: string): string {
  const safe = assertSafeIdentifier(collection, "MongoDB collection");
  const allowlist = envCsv("MONGODB_COLLECTION_ALLOWLIST", "*");
  if (!matchesAllowlist(safe, allowlist)) {
    throw new Error(`Collection ${safe} is outside MONGODB_COLLECTION_ALLOWLIST`);
  }
  return safe;
}

function asJson(value: unknown): unknown {
  return JSON.parse(BSON.EJSON.stringify(value, { relaxed: true })) as unknown;
}

server.registerTool(
  "mongodb_find",
  {
    title: "Find MongoDB/DocumentDB documents (read-only)",
    description:
      "Run a bounded find with optional projection and sort. Server-side JavaScript and all write operators are rejected.",
    inputSchema: z.object({
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
    runTool(SERVER, "mongodb_find", { collection: input.collection, filter: input.filter }, async () => {
      assertSafeMongoValue(input.filter);
      if (input.projection) assertSafeMongoValue(input.projection);
      if (input.sort) assertSafeMongoValue(input.sort);
      const client = await getClient();
      const limit = Math.min(
        input.limit,
        envInteger("MONGODB_MAX_DOCUMENTS", 500, 1, 10_000),
      );
      let cursor = client
        .db(databaseName())
        .collection(assertCollection(input.collection))
        .find(input.filter as Document, {
          maxTimeMS: envInteger("MONGODB_QUERY_TIMEOUT_MS", 30_000, 1_000, 300_000),
        })
        .limit(limit);
      if (input.projection) cursor = cursor.project(input.projection);
      if (input.sort) cursor = cursor.sort(input.sort);
      const documents = await cursor.toArray();
      return {
        documents: asJson(documents),
        count: documents.length,
        truncated: documents.length >= limit,
        database: databaseName(),
      };
    }),
);

server.registerTool(
  "mongodb_aggregate",
  {
    title: "Aggregate MongoDB/DocumentDB data (read-only)",
    description:
      "Run an aggregation using only allowlisted read stages. $out, $merge, $function, $accumulator, and $where are blocked recursively.",
    inputSchema: z.object({
      collection: z.string().min(1).max(128),
      pipeline: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
      maxDocuments: z.number().int().min(1).max(2_000).default(200),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "mongodb_aggregate", { collection: input.collection, pipeline: input.pipeline }, async () => {
      assertReadOnlyPipeline(input.pipeline);
      assertMongoCollectionScopes(
        input.pipeline,
        envCsv("MONGODB_COLLECTION_ALLOWLIST", "*"),
      );
      const limit = Math.min(
        input.maxDocuments,
        envInteger("MONGODB_MAX_DOCUMENTS", 500, 1, 10_000),
      );
      const pipeline = [...input.pipeline, { $limit: limit }] as Document[];
      const client = await getClient();
      const documents = await client
        .db(databaseName())
        .collection(assertCollection(input.collection))
        .aggregate(pipeline, {
          allowDiskUse: false,
          maxTimeMS: envInteger("MONGODB_QUERY_TIMEOUT_MS", 30_000, 1_000, 300_000),
        })
        .toArray();
      return {
        documents: asJson(documents),
        count: documents.length,
        truncated: documents.length >= limit,
        database: databaseName(),
      };
    }),
);

server.registerTool(
  "mongodb_list_collections",
  {
    title: "List visible MongoDB/DocumentDB collections",
    description: "List collection names visible to the configured read-only database principal.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "mongodb_list_collections", input, async () => {
      const client = await getClient();
      const allowlist = envCsv("MONGODB_COLLECTION_ALLOWLIST", "*");
      const collections = await client.db(databaseName()).listCollections({}, { nameOnly: true }).toArray();
      return {
        database: databaseName(),
        collections: collections
          .map((item) => item.name)
          .filter((name) => matchesAllowlist(name, allowlist))
          .sort(),
      };
    }),
);

server.registerTool(
  "mongodb_sample_schema",
  {
    title: "Sample MongoDB/DocumentDB document shape",
    description: "Return a small read-only sample to infer field names and BSON types.",
    inputSchema: z.object({
      collection: z.string().min(1).max(128),
      sampleSize: z.number().int().min(1).max(20).default(5),
    }),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "mongodb_sample_schema", input, async () => {
      const client = await getClient();
      const documents = await client
        .db(databaseName())
        .collection(assertCollection(input.collection))
        .find(
          {},
          {
            maxTimeMS: envInteger("MONGODB_QUERY_TIMEOUT_MS", 30_000, 1_000, 300_000),
          },
        )
        .limit(input.sampleSize)
        .toArray();
      return { database: databaseName(), documents: asJson(documents) };
    }),
);

server.registerTool(
  "mongodb_health",
  {
    title: "Check MongoDB/DocumentDB read connection",
    description: "Run ping and return the configured database name without modifying data.",
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  },
  async (input) =>
    runTool(SERVER, "mongodb_health", input, async () => {
      if (!enabled("MONGODB")) return { status: "disabled", integration: "mongodb" };
      const client = await getClient();
      const ping = await client.db(databaseName()).command({ ping: 1 });
      return {
        status: "ok",
        database: databaseName(),
        mode: env("MONGODB_MODE", { defaultValue: "mongodb", allowPlaceholder: true }),
        ping: asJson(ping),
        tlsCaConfigured: Boolean(env("MONGODB_TLS_CA_FILE", { allowPlaceholder: true })),
      };
    }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void clientPromise?.then((client) => client.close()).finally(() => process.exit(0));
  });
}

await startServer(server);
