import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  realpath,
  readFile,
  writeFile,
  mkdir,
  rename,
} from "node:fs/promises";
import path from "node:path";

export const digest = (data) => createHash("sha256").update(data).digest("hex");
export const MAX_FILE = 25 * 1024 * 1024;
export const MAX_PACKAGE = 200 * 1024 * 1024;
export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
export function id(value) {
  requireValue(
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value),
    "Invalid identifier.",
  );
  return value;
}
export async function inside(root, relative, exists = true) {
  requireValue(
    typeof relative === "string" &&
      relative.length > 0 &&
      !path.isAbsolute(relative) &&
      !relative.split(/[\\/]/).some((part) => part === ".." || part === ""),
    "Use a relative path inside the configured directory.",
  );
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error) => {
      if (!exists && error.code === "ENOENT") return null;
      throw error;
    });
    requireValue(!info?.isSymbolicLink(), "Symbolic links are not allowed.");
  }
  if (exists)
    requireValue(
      (await realpath(current)).startsWith(
        `${await realpath(root)}${path.sep}`,
      ),
      "Path leaves the configured directory.",
    );
  return current;
}
export async function atomic(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
}
export async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return realpath(directory);
}
export const cliEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/TOKEN|PASSWORD|SECRET|API_KEY|DATABASE|ANTHROPIC|OPENAI|CLAUDECODE|CLAUDE_CODE_USE/.test(
          key,
        ),
    ),
  );
/** @param {string} binary @param {string[]} args @param {{cwd?: string, signal?: AbortSignal, input?: string, timeout?: number, trim?: boolean, env?: NodeJS.ProcessEnv}} options */
export function command(
  binary,
  args,
  {
    cwd = undefined,
    signal = undefined,
    input = undefined,
    timeout = 300_000,
    trim = true,
    env = cliEnvironment(),
  } = {},
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let output = "",
      errors = "",
      problem;
    const stop = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {}
      }
    };
    const timer = setTimeout(() => {
      problem = new Error("Command timed out.");
      stop();
      killTimer = setTimeout(hardStop, 2000);
    }, timeout);
    const hardStop = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    };
    let killTimer;
    const cancel = () => {
      problem = new Error("Cancelled.");
      stop();
      killTimer = setTimeout(hardStop, 2000);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (part) => {
      output += part;
      if (Buffer.byteLength(output) > 8 * 1024 * 1024) {
        problem = new Error("Command output exceeds 8 MiB.");
        hardStop();
      }
    });
    child.stderr.on("data", (part) => {
      if (errors.length < 100_000) errors += part;
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      problem = new Error(
        error.code === "ENOENT"
          ? `Required executable is unavailable: ${binary}`
          : "Unable to start command.",
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", cancel);
      if (problem) reject(problem);
      else if (code)
        reject(
          new Error(
            `${path.basename(binary)} failed (${code}).\n${`${errors}\n${output}`.trim().slice(-12_000)}`,
          ),
        );
      else resolve(trim ? output.trim() : output);
    });
    child.stdin.end(input);
  });
}
export async function pdf(file, signal, max = MAX_FILE) {
  const data = await readFile(file);
  requireValue(
    data.length > 0 &&
      data.length <= max &&
      data.subarray(0, 5).toString() === "%PDF-",
    "Invalid or oversized PDF.",
  );
  const info = await command("pdfinfo", [file], { signal });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  requireValue(
    pages > 0 && !/^Encrypted:\s+yes/m.test(info),
    "PDF is encrypted or has no pages.",
  );
  return { data: data.toString("base64"), checksum: digest(data), pages };
}
