import { execFile } from "node:child_process";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { assertNoControlCharacters, ConfigError, env } from "./env.js";
import { redactText } from "./redact.js";

const execFileAsync = promisify(execFile);

type ExecOptions = {
  timeoutMs: number;
  maxBuffer: number;
};

export function configuredExecutable(
  environmentName: string,
  defaultValue: string,
  allowedBasenames: readonly string[],
): string {
  const command = env(environmentName, {
    defaultValue,
    allowPlaceholder: true,
  });
  assertNoControlCharacters(command, environmentName);
  const normalizedBasename = basename(command).toLowerCase();
  if (!allowedBasenames.map((item) => item.toLowerCase()).includes(normalizedBasename)) {
    throw new ConfigError(
      `${environmentName} must name ${allowedBasenames.join(" or ")} (an absolute path is allowed)`,
    );
  }
  if (
    !isAbsolute(command) &&
    command !== basename(command) &&
    command.replaceAll("\\", "/").includes("/")
  ) {
    throw new ConfigError(`${environmentName} must be a command name or an absolute path`);
  }
  return command;
}

export async function executeBoundedProcess(
  command: string,
  args: readonly string[],
  options: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, [...args], {
      encoding: "utf8",
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer,
      windowsHide: true,
      shell: false,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const processError =
      error && typeof error === "object"
        ? (error as {
            code?: unknown;
            killed?: unknown;
            signal?: unknown;
            stderr?: unknown;
          })
        : undefined;
    const status = [
      processError?.code ? `code=${String(processError.code)}` : "",
      processError?.signal ? `signal=${String(processError.signal)}` : "",
      processError?.killed ? "terminated=true" : "",
    ].filter(Boolean);
    const stderr = String(processError?.stderr ?? "").trim();
    const detail = [...status, stderr].filter(Boolean).join("; ");
    throw new Error(
      redactText(
        `External authentication helper failed${detail ? `: ${detail}` : ""}`,
      ),
    );
  }
}
