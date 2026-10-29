import { spawn, execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

const MAX_BODY = 2 * 1024 * 1024;
const MAX_OUTPUT = 8 * 1024 * 1024;
const CONCURRENCY = 3;

export class BridgeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function readConfig(source = process.env) {
  const token = source.DOSSIER_CODEX_BRIDGE_TOKEN;
  if (!token || token.length < 32 || /\s/.test(token)) {
    throw new Error("Set DOSSIER_CODEX_BRIDGE_TOKEN to a random token of at least 32 characters without whitespace.");
  }
  const port = Number(source.DOSSIER_CODEX_BRIDGE_PORT ?? 8787);
  const timeoutSeconds = Number(source.DOSSIER_CODEX_TIMEOUT_SECONDS ?? 300);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DOSSIER_CODEX_BRIDGE_PORT must be between 1 and 65535.");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) throw new Error("DOSSIER_CODEX_TIMEOUT_SECONDS must be a positive integer.");
  return {
    token,
    port,
    timeoutMs: timeoutSeconds * 1000,
    binary: source.DOSSIER_CODEX_BIN || "codex",
    model: source.DOSSIER_CODEX_MODEL || "gpt-6.1-sol",
  };
}

function codexEnvironment() {
  const names = [
    "HOME", "PATH", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY",
  ];
  return Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
}

export async function checkLogin(config) {
  try {
    const result = await promisify(execFile)(config.binary, ["login", "status"], {
      env: codexEnvironment(), timeout: 10_000, maxBuffer: 64 * 1024,
    });
    if (!/Logged in using ChatGPT/i.test(result.stdout + result.stderr)) throw new Error("Not a ChatGPT login.");
  } catch (error) {
    if (error.code === "ENOENT") throw new BridgeError(503, "codex_unavailable", "Codex was not found. Set DOSSIER_CODEX_BIN to its executable path.");
    throw new BridgeError(503, "codex_auth_required", "Run codex login as the user running this bridge and sign in with ChatGPT.");
  }
}

export async function loadModelCatalog(config) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.binary, ["app-server", "-c", "features.apps=false", "-c", "mcp_servers={}", "-c", 'forced_login_method="chatgpt"'], {
      cwd: tmpdir(), env: codexEnvironment(), stdio: ["pipe", "pipe", "pipe"], detached: true,
    });
    const catalog = [];
    let result, problem, killTimer;
    const stop = () => {
      if (!child.pid || killTimer) return;
      const kill = (signal) => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 1000);
      killTimer.unref();
    };
    const fail = () => {
      problem = new BridgeError(503, "codex_catalog", "Could not load the Codex model catalog. Check Codex login and restart the bridge.");
      stop();
    };
    const timer = setTimeout(fail, 12_000);
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    child.stdin.on("error", () => {});
    child.stderr.resume();
    child.once("error", fail);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id === 1) {
          if (message.error) return fail();
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "model/list", params: { limit: 100, includeHidden: false } });
        }
        if (message.id !== 2) return;
        if (message.error || !Array.isArray(message.result?.data)) return fail();
        for (const model of message.result.data) {
          if (typeof model.model !== "string" || !Array.isArray(model.supportedReasoningEfforts) || typeof model.defaultReasoningEffort !== "string") return fail();
          const efforts = model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
          if (!efforts.length || efforts.some((effort) => typeof effort !== "string")) return fail();
          catalog.push({ id: model.model, display_name: model.displayName, reasoning_efforts: efforts, default_reasoning_effort: model.defaultReasoningEffort });
        }
        if (message.result.nextCursor) {
          send({ id: 2, method: "model/list", params: { limit: 100, includeHidden: false, cursor: message.result.nextCursor } });
        } else if (catalog.length) {
          result = catalog;
          stop();
        } else fail();
      } catch { fail(); }
    });
    child.once("close", () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      lines.close();
      if (!problem && result) resolve(result);
      else reject(problem ?? new BridgeError(503, "codex_catalog", "Codex exited before returning its model catalog."));
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "dossier", title: "Dossier", version: "1.9.2" } } });
  });
}

function invalid(message) {
  throw new BridgeError(400, "codex_invalid_request", message);
}

export function validateRequest(body, catalog) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Expected a JSON object.");
  const supported = new Set(["model", "messages", "stream", "response_format", "temperature", "max_tokens", "max_completion_tokens", "reasoning_effort"]);
  if (Object.keys(body).some((key) => !supported.has(key))) invalid("This bridge only supports text chat completions and JSON-schema output.");
  const model = catalog.find((model) => model.id === body.model);
  if (!model) throw new BridgeError(404, "codex_model", "Choose a model advertised by /v1/models.");
  const effort = body.reasoning_effort ?? "medium";
  if (!model.reasoning_efforts.includes(effort)) throw new BridgeError(400, "codex_effort", "Choose a thinking effort supported by the selected model.");
  if (body.stream !== undefined && body.stream !== false) invalid("Streaming is not supported.");
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.some((message) =>
    !message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" ||
    Object.keys(message).some((key) => key !== "role" && key !== "content"),
  )) invalid("messages must contain system, user or assistant messages with text content.");
  for (const key of ["max_tokens", "max_completion_tokens"]) {
    if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < 1)) invalid(`${key} must be a positive integer.`);
  }
  if (body.temperature !== undefined && (typeof body.temperature !== "number" || !Number.isFinite(body.temperature))) invalid("temperature must be a number.");
  if (body.response_format !== undefined) {
    const format = body.response_format;
    if (!format || format.type !== "json_schema" || !format.json_schema?.schema ||
      typeof format.json_schema.schema !== "object" || Array.isArray(format.json_schema.schema)) {
      invalid("response_format must contain a JSON schema.");
    }
  }
  return { ...body, reasoning_effort: effort };
}

function cliFailure(message) {
  if (/not logged in|unauthorized|authentication|refresh.*token|token.*expired|401\b/i.test(message)) {
    return new BridgeError(503, "codex_auth_required", "Sign in again with codex login on the host.");
  }
  if (/usage limit|rate.?limit|quota|429\b|credits.*(exhausted|remaining)|insufficient_quota/i.test(message)) {
    return new BridgeError(429, "codex_quota", "Your ChatGPT account has reached its Codex usage limit.");
  }
  if (/model.*(not found|not supported|does not exist|not available|access)|unsupported.*model/i.test(message)) {
    return new BridgeError(404, "codex_model", "This model is not available to your Codex account.");
  }
  if (/context.*(exceed|length|limit)|too many tokens|input.*too long/i.test(message)) {
    return new BridgeError(413, "codex_context", "The request exceeds the model's context limit.");
  }
  return new BridgeError(502, "codex_failed", "Codex could not complete the request. Check its login and connectivity on the host.");
}

export async function runCodex(request, config, signal) {
  signal.throwIfAborted();
  const directory = await mkdtemp(path.join(tmpdir(), "dossier-codex-"));
  try {
    const args = [
      "exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
      "--sandbox", "read-only", "--model", request.model, "--color", "never",
      "-c", 'forced_login_method="chatgpt"',
      "-c", "features.shell_tool=false", "-c", "features.apps=false", "-c", "tools.view_image=false",
      "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0", "-c", `model_reasoning_effort=${JSON.stringify(request.reasoning_effort ?? "medium")}`,
    ];
    if (request.response_format) {
      const schemaPath = path.join(directory, "schema.json");
      await writeFile(schemaPath, JSON.stringify(request.response_format.json_schema.schema), { mode: 0o600 });
      args.push("--output-schema", schemaPath);
    }
    const budget = request.max_completion_tokens ?? request.max_tokens;
    const prompt = [
      "Complete this Dossier text-generation request. Follow the system messages as instructions and continue the ordered conversation as the assistant.",
      "Return only the requested final answer. Do not use tools, read local files, or perform actions.",
      ...(budget ? [`Keep the final answer within approximately ${budget} tokens.`] : []),
      "The conversation is serialized below as JSON:", JSON.stringify(request.messages),
    ].join("\n\n");
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const child = spawn(config.binary, [...args, "-"], {
        cwd: directory, env: codexEnvironment(), stdio: ["pipe", "pipe", "pipe"], detached: true,
      });
      let buffer = "", stderr = "", lastError = "", text = "", usage;
      let bytes = 0, completed = false, failed = false, exited = false, localError, killTimer;
      const stop = () => {
        if (!child.pid || killTimer || exited) return;
        const kill = (name) => {
          try { process.kill(-child.pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; }
        };
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 1000);
        killTimer.unref();
      };
      const consume = (line) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line);
          if (event.type === "item.completed" && event.item?.type === "agent_message") text = event.item.text;
          if (event.type === "turn.completed") { completed = true; usage = event.usage; }
          if (event.type === "turn.failed") failed = true;
          if (event.type === "error" || event.type === "turn.failed") lastError = String(event.message ?? event.error?.message ?? "");
        } catch {
          localError = new BridgeError(502, "codex_output", "Codex returned an invalid event stream.");
          stop();
        }
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_OUTPUT) {
          localError = new BridgeError(502, "codex_output", "Codex output exceeded the bridge's size limit.");
          stop();
          return;
        }
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) consume(line);
      });
      child.stderr.on("data", (chunk) => { if (stderr.length < 64 * 1024) stderr += chunk.slice(0, 64 * 1024 - stderr.length); });
      child.stdin.on("error", () => {}); // A failed CLI may close stdin before it reads the prompt.
      child.once("error", (error) => {
        localError = error.code === "ENOENT"
          ? new BridgeError(503, "codex_unavailable", "The Codex executable was not found on the host.")
          : new BridgeError(502, "codex_failed", "Could not start Codex on the host.");
      });
      child.once("close", (code) => {
        exited = true;
        signal.removeEventListener("abort", stop);
        if (killTimer) clearTimeout(killTimer);
        if (buffer && !localError) consume(buffer);
        if (signal.aborted) reject(signal.reason);
        else if (localError) reject(localError);
        else if (code !== 0 || failed) reject(cliFailure(lastError + "\n" + stderr));
        else if (!completed || typeof text !== "string" || !text.trim()) reject(new BridgeError(502, "codex_output", "Codex exited without a completed answer."));
        else resolve({ text, usage });
      });
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      else child.stdin.end(prompt);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readBody(request, signal) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const finish = (callback, value) => {
      request.removeListener("data", data);
      request.removeListener("end", end);
      request.removeListener("error", error);
      signal.removeEventListener("abort", abort);
      request.resume();
      callback(value);
    };
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
        finish(reject, new BridgeError(413, "codex_invalid_request", "Request body exceeds 2 MiB."));
      } else chunks.push(chunk);
    };
    const end = () => {
      try { finish(resolve, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { finish(reject, new BridgeError(400, "codex_invalid_request", "Request body must be valid JSON.")); }
    };
    const error = (reason) => finish(reject, reason);
    const abort = () => finish(reject, signal.reason);
    request.on("data", data);
    request.once("end", end);
    request.once("error", error);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function send(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff",
    ...(status >= 400 ? { "x-should-retry": "false" } : {}),
  });
  response.end(JSON.stringify(body));
}

export function createBridge(config, catalog) {
  const expected = Buffer.from(`Bearer ${config.token}`);
  const controllers = new Set(), pending = new Set();
  let running = 0;
  async function handle(request, response) {
    const supplied = Buffer.from(request.headers.authorization ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      send(response, 401, { error: { code: "codex_bridge_auth", message: "The local bridge token is missing or incorrect." } });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/models") {
      send(response, 200, { object: "list", data: catalog.map((model) => ({ ...model, object: "model", created: 0, owned_by: "codex" })) });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      send(response, 404, { error: { code: "codex_invalid_request", message: "Unknown route." } });
      return;
    }
    if (running >= CONCURRENCY) {
      send(response, 429, { error: { code: "codex_busy", message: "Three Codex requests are already running. Try again when one finishes." } });
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    running++;
    const cancelled = () => controller.abort(new BridgeError(499, "codex_cancelled", "Cancelled."));
    request.once("aborted", cancelled);
    response.once("close", () => { if (!response.writableEnded) cancelled(); });
    const timer = setTimeout(() => controller.abort(new BridgeError(504, "codex_timeout", "Codex took too long to answer.")), config.timeoutMs);
    try {
      const body = validateRequest(await readBody(request, controller.signal), catalog);
      const answer = await runCodex(body, config, controller.signal);
      const usage = answer.usage ? {
        prompt_tokens: answer.usage.input_tokens,
        completion_tokens: answer.usage.output_tokens,
        total_tokens: answer.usage.input_tokens + answer.usage.output_tokens,
      } : undefined;
      send(response, 200, {
        id: `chatcmpl-${randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: answer.text }, finish_reason: "stop" }],
        ...(usage ? { usage } : {}),
      });
    } catch (error) {
      const problem = error instanceof BridgeError ? error : new BridgeError(502, "codex_failed", "The Codex bridge could not complete the request.");
      if (problem.status >= 500 || problem.code === "codex_quota") console.error(`[codex-bridge] ${problem.code}: ${problem.message}`);
      send(response, problem.status, { error: { code: problem.code, message: problem.message } });
    } finally {
      clearTimeout(timer);
      request.removeListener("aborted", cancelled);
      controllers.delete(controller);
      running--;
    }
  }
  const server = http.createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (request, response) => {
    const work = handle(request, response);
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });
  return {
    server,
    async close() {
      const closed = new Promise((resolve) => server.close(resolve));
      for (const controller of controllers) controller.abort(new BridgeError(499, "codex_cancelled", "Bridge is stopping."));
      server.closeAllConnections();
      await Promise.allSettled([...pending]);
      await closed;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const config = readConfig();
    await checkLogin(config);
    const catalog = await loadModelCatalog(config);
    const bridge = createBridge(config, catalog);
    bridge.server.once("error", (error) => { console.error(`[codex-bridge] Cannot listen: ${error.code}`); process.exitCode = 1; });
    bridge.server.listen(config.port, "127.0.0.1", () => console.log(`[codex-bridge] http://127.0.0.1:${config.port}/v1 · ${catalog.length} models`));
    const stop = () => { void bridge.close().then(() => { process.exitCode = 0; }); };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch (error) {
    console.error(`[codex-bridge] ${error.message}`);
    process.exitCode = 1;
  }
}
