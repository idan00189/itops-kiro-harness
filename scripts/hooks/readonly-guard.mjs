import process from "node:process";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let event;
try {
  event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.stderr.write("ITOps guard blocked a tool call because hook input was invalid JSON.\n");
  process.exit(2);
}

const tool = String(event.tool_name ?? event.toolName ?? "").toLowerCase();
const localWriters = [
  "report_write",
  "artifact_write_splunk_dashboard",
];
const builtinBlocked = new Set(["write", "fs_write", "shell", "execute_bash"]);
const mutatingVerb =
  /(?:^|[\/@_.-])(create|update|delete|write|sync|rollback|restart|refresh|patch|put|exec|execute|action|terminate|deploy|ingest|upload)(?:$|[\/@_.-])/i;

if (builtinBlocked.has(tool)) {
  process.stderr.write(`ITOps read-only policy blocks built-in tool '${tool}'.\n`);
  process.exit(2);
}

if (mutatingVerb.test(tool) && !localWriters.some((allowed) => tool.includes(allowed))) {
  process.stderr.write(`ITOps read-only policy blocks potentially mutating tool '${tool}'.\n`);
  process.exit(2);
}

process.exit(0);
