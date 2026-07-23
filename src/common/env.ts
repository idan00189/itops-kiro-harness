import { URL } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type EnvOptions = {
  defaultValue?: string;
  required?: boolean;
  allowPlaceholder?: boolean;
};

const PLACEHOLDER = /^(?:CHANGE_ME|REPLACE_ME|YOUR_|<.+>|\$\{.+\})/i;

export function env(name: string, options: EnvOptions = {}): string {
  const raw = process.env[name]?.trim();
  const value = raw || options.defaultValue;
  if (!value && options.required) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  if (value && !options.allowPlaceholder && PLACEHOLDER.test(value)) {
    throw new ConfigError(`Environment variable ${name} still contains a placeholder`);
  }
  return value ?? "";
}

export function envBoolean(name: string, defaultValue = false): boolean {
  const value = env(name, { defaultValue: String(defaultValue), allowPlaceholder: true }).toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  throw new ConfigError(`${name} must be true or false`);
}

export function envInteger(
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(env(name, { defaultValue: String(defaultValue), allowPlaceholder: true }));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConfigError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function envCsv(name: string, defaultValue = ""): string[] {
  return env(name, { defaultValue, allowPlaceholder: true })
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function requireSafeBaseUrl(name: string): URL {
  const value = env(name, { required: true });
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL`);
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new ConfigError(`${name} must use HTTPS (HTTP is allowed only for localhost)`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed;
}

export function workspacePath(name: string, defaultValue: string): string {
  const root = resolve(process.cwd());
  const target = resolve(env(name, { defaultValue, allowPlaceholder: true }));
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(pathFromRoot)) {
    throw new ConfigError(`${name} must resolve inside the ITOps workspace`);
  }
  return target;
}

export function enabled(name: string): boolean {
  return envBoolean(`ITOPS_ENABLE_${name.toUpperCase().replaceAll("-", "_")}`, true);
}

export function assertNoControlCharacters(value: string, label: string): void {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw new ConfigError(`${label} contains control characters`);
  }
}
