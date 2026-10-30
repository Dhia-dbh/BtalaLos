import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { checkLogin, createBridge, loadModelCatalog, readConfig, runCodex } from "./codex-bridge.mjs";

const token = "bridge-test-token-with-at-least-32-characters";
const directory = await mkdtemp(path.join(tmpdir(), "dossier-bridge-test-"));
const binary = path.join(directory, "codex-stub.mjs");
const auditPath = path.join(directory, "audit.jsonl");
const catalog = [
  { id: "codex-test", display_name: "Codex Test", reasoning_efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], default_reasoning_effort: "low" },
  { id: "codex-small", display_name: "Codex Small", reasoning_efforts: ["low", "medium"], default_reasoning_effort: "medium" },
];
await writeFile(binary, `#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
if (args[0] === 'app-server') {
 const {createInterface} = await import('node:readline');
 let initialized = false;
 const models = ${JSON.stringify(catalog)};
 for await (const line of createInterface({input:process.stdin})) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') console.log(JSON.stringify({id:message.id,result:{userAgent:'test'}}));
  if (message.method === 'initialized') initialized = true;
  if (message.method === 'model/list') {
   if (!initialized) throw new Error('Missing initialized notification');
   const index = message.params.cursor ? 1 : 0;
   const model = models[index];
   console.log(JSON.stringify({id:message.id,result:{data:[{model:model.id,displayName:model.display_name,defaultReasoningEffort:model.default_reasoning_effort,
    supportedReasoningEfforts:model.reasoning_efforts.map(reasoningEffort=>({reasoningEffort}))}],nextCursor:index===0?'next':null}}));
  }
 }
 process.exit(0);
}
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const messages = JSON.parse(prompt.split('The conversation is serialized below as JSON:\\n\\n')[1]);
const mode = messages.at(-1).content;
const schemaIndex = args.indexOf('--output-schema');
const schema = schemaIndex >= 0 ? JSON.parse(fs.readFileSync(args[schemaIndex + 1], 'utf8')) : null;
let descendant;
if (mode === 'hang') {
  descendant = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {stdio: 'inherit'});
  process.on('SIGTERM', () => {});
}
fs.appendFileSync(${JSON.stringify(auditPath)}, JSON.stringify({pid: process.pid, descendant: descendant?.pid, cwd: process.cwd(), args, messages, prompt, schema,
  secrets: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'DOSSIER_CODEX_BRIDGE_TOKEN', 'DATABASE_URL', 'CODEX_THREAD_ID'].filter(key => process.env[key])}) + '\\n');
if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'auth') { console.error('Unauthorized: refresh token expired PRIVATE'); process.exit(1); }
else if (mode === 'schema') { console.error('Invalid schema for response_format PRIVATE'); process.exit(1); }
else if (mode === 'quota') { console.error('You have reached your usage limit PRIVATE'); process.exit(1); }
else if (mode === 'model') { console.error('The model is not available PRIVATE'); process.exit(1); }
else if (mode === 'context') { console.error('Context length exceeds limit PRIVATE'); process.exit(1); }
else if (mode === 'failure') { console.error('PRIVATE credential and profile'); process.exit(1); }
else if (mode === 'malformed') { console.log('not JSON PRIVATE'); }
else if (mode === 'missing') { console.log(JSON.stringify({type:'item.completed', item:{type:'agent_message',text:'unfinished'}})); }
else if (mode === 'failed-turn') {
  console.log(JSON.stringify({type:'turn.failed', error:{message:'usage limit PRIVATE'}}));
}
else if (mode === 'oversized') { process.stdout.write('x'.repeat(9 * 1024 * 1024)); }
else {
  const text = mode === 'json' ? JSON.stringify({name:'Ada', note:null}) : 'Résumé ✓';
  const output = [
    {type:'thread.started', thread_id:'fake'},
    {type:'item.completed',item:{type:'agent_message',text:'intermediate commentary'}},
    {type:'item.completed',item:{type:'agent_message',text}},
    {type:'turn.completed',usage:{input_tokens:11,output_tokens:3}},
  ].map(value => JSON.stringify(value)).join('\\n');
  const data = Buffer.from(output);
  process.stdout.write(data.subarray(0, 71));
  setImmediate(() => process.stdout.end(data.subarray(71)));
}
`, { mode: 0o700 });
after(() => rm(directory, { recursive: true, force: true }));

const config = { token, binary, model: "codex-test", timeoutMs: 10_000 };
const request = (content = "text") => ({ model: config.model, messages: [{ role: "system", content: "Be factual." }, { role: "user", content }] });
async function audit() {
  try { return (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
async function waitForAudit(count) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const entries = await audit();
    if (entries.length >= count) return entries;
    await delay(20);
  }
  assert.fail("CLI did not start");
}
async function serve(t, overrides = {}) {
  const bridge = createBridge({ ...config, ...overrides }, catalog);
  await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  t.after(() => bridge.close());
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  const post = (body, init = {}) => fetch(`${base}/v1/chat/completions`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), ...init,
  });
  return { base, post, bridge };
}

test("configuration requires a strong local token and validates limits", () => {
  assert.throws(() => readConfig({}), /TOKEN/);
  assert.throws(() => readConfig({ DOSSIER_CODEX_BRIDGE_TOKEN: "short" }), /TOKEN/);
  assert.throws(() => readConfig({ DOSSIER_CODEX_BRIDGE_TOKEN: token, DOSSIER_CODEX_BRIDGE_PORT: "0" }), /PORT/);
  assert.throws(() => readConfig({ DOSSIER_CODEX_BRIDGE_TOKEN: token, DOSSIER_CODEX_TIMEOUT_SECONDS: "NaN" }), /SECONDS/);
  assert.equal(readConfig({ DOSSIER_CODEX_BRIDGE_TOKEN: token }).model, "gpt-6.1-sol");
});

test("startup checks ChatGPT authentication and reports a missing binary", async () => {
  await checkLogin(config);
  await assert.rejects(checkLogin({ ...config, binary: path.join(directory, "missing") }), { code: "codex_unavailable" });
  const apiLogin = path.join(directory, "api-login.mjs");
  await writeFile(apiLogin, '#!/usr/bin/env node\nconsole.log("Logged in using an API key");', { mode: 0o700 });
  await assert.rejects(checkLogin({ ...config, binary: apiLogin }), { code: "codex_auth_required" });
});

test("loads all model-catalog pages after the app-server handshake", async () => {
  assert.deepEqual(await loadModelCatalog(config), catalog);
  await assert.rejects(loadModelCatalog({ ...config, binary: path.join(directory, "missing") }), { code: "codex_catalog" });
});

test("requires the local token and advertises model names and supported thinking levels", async (t) => {
  const { base } = await serve(t);
  for (const authorization of [undefined, "Bearer wrong", "Bearer not-needed"]) {
    const response = await fetch(`${base}/v1/models`, { headers: authorization ? { authorization } : {} });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("x-should-retry"), "false");
    assert.equal((await response.json()).error.code, "codex_bridge_auth");
  }
  const response = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const models = (await response.json()).data;
  assert.deepEqual(models.map((model) => model.id), catalog.map((model) => model.id));
  assert.deepEqual(models[0].reasoning_efforts, catalog[0].reasoning_efforts);
});

test("routes each selected model and thinking effort to Codex without substituting them", async (t) => {
  const { post } = await serve(t);
  for (const [model, effort] of [["codex-test", "xhigh"], ["codex-test", "ultra"], ["codex-small", "low"]]) {
    const response = await post({ ...request(), model, reasoning_effort: effort });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).model, model);
    const call = (await audit()).at(-1);
    assert.equal(call.args[call.args.indexOf("--model") + 1], model);
    assert.ok(call.args.includes(`model_reasoning_effort=${JSON.stringify(effort)}`));
  }
  const before = (await audit()).length;
  const rejected = await post({ ...request(), model: "codex-small", reasoning_effort: "ultra" });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, "codex_effort");
  assert.equal((await audit()).length, before);
});

test("translates complete text events and token usage, preserving conversation history", async (t) => {
  const { post } = await serve(t);
  const messages = [...request().messages, { role: "assistant", content: "Earlier reply" }, { role: "user", content: "text" }];
  const response = await post({ ...request(), messages, max_tokens: 100, temperature: 0.2 });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.choices[0].message.content, "Résumé ✓");
  assert.equal(body.choices[0].finish_reason, "stop");
  assert.deepEqual(body.usage, { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 });
  const call = (await audit()).at(-1);
  assert.deepEqual(call.messages, messages);
  assert.match(call.prompt, /approximately 100 tokens/);
  assert.ok(call.args.includes("--ephemeral") && call.args.includes("--ignore-user-config"));
  assert.ok(call.args.includes('forced_login_method="chatgpt"') && call.args.includes("features.shell_tool=false"));
  assert.ok(!call.args.some((arg) => arg.includes("Earlier reply")));
  await assert.rejects(readdir(call.cwd), { code: "ENOENT" });
});

test("passes a JSON schema natively and excludes application secrets and CLI session metadata", async () => {
  const names = ["OPENAI_API_KEY", "CODEX_API_KEY", "DOSSIER_CODEX_BRIDGE_TOKEN", "DATABASE_URL", "CODEX_THREAD_ID"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = "PRIVATE";
  const schema = { type: "object", properties: { name: { type: "string" }, note: { type: ["string", "null"] } }, required: ["name", "note"], additionalProperties: false };
  try {
    const answer = await runCodex({ ...request("json"), response_format: { type: "json_schema", json_schema: { name: "person", schema, strict: true } } }, config, new AbortController().signal);
    assert.deepEqual(JSON.parse(answer.text), { name: "Ada", note: null });
    const call = (await audit()).at(-1);
    assert.deepEqual(call.schema, schema);
    assert.deepEqual(call.secrets, []);
    await assert.rejects(readdir(call.cwd), { code: "ENOENT" });
  } finally {
    for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
  }
});

test("rejects unsupported input before launching Codex", async (t) => {
  const { post } = await serve(t);
  const count = (await audit()).length;
  for (const body of [null, [], { ...request(), stream: true }, { ...request(), tools: [] }, { ...request(), max_tokens: -1 },
    { ...request(), messages: [{ role: "tool", content: "text" }] }, { ...request(), messages: [{ role: "user", content: [] }] },
    { ...request(), response_format: { type: "json_object" } }]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await post({ ...request(), model: "not-offered" })).status, 404);
  assert.equal((await post(request(), { body: "invalid JSON" })).status, 400);
  assert.equal((await post(request(), { body: "x".repeat(2 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await audit()).length, count);
});

test("classifies CLI failures without leaking stderr and never accepts unfinished output", async (t) => {
  const { post } = await serve(t);
  for (const [mode, status, code] of [
    ["schema", 400, "codex_schema"], ["auth", 503, "codex_auth_required"], ["quota", 429, "codex_quota"], ["model", 404, "codex_model"],
    ["context", 413, "codex_context"], ["failure", 502, "codex_failed"], ["malformed", 502, "codex_output"],
    ["missing", 502, "codex_output"], ["failed-turn", 429, "codex_quota"], ["oversized", 502, "codex_output"],
  ]) {
    const response = await post(request(mode));
    assert.equal(response.status, status, mode);
    const body = await response.text();
    assert.equal(JSON.parse(body).error.code, code, mode);
    assert.ok(!body.includes("PRIVATE"));
  }
});

function assertStopped(pid) {
  // A killed descendant can briefly remain as a zombie until its parent is reaped.
  return readFile(`/proc/${pid}/stat`, "utf8").then((stat) => assert.match(stat, /\) Z /)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

test("timeout kills the CLI process group and removes temporary data", async (t) => {
  const { post } = await serve(t, { timeoutMs: 300 });
  const response = await post(request("hang"));
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, "codex_timeout");
  const call = (await audit()).at(-1);
  await assertStopped(call.pid);
  await assertStopped(call.descendant);
  await assert.rejects(readdir(call.cwd), { code: "ENOENT" });
});

test("disconnect cancels Codex; the three-call limit and shutdown clean up all processes", async (t) => {
  const { post, bridge } = await serve(t);
  const start = (await audit()).length;
  const aborts = Array.from({ length: 3 }, () => new AbortController());
  const calls = aborts.map((controller) => post(request("hang"), { signal: controller.signal }).catch((error) => error));
  const entries = (await waitForAudit(start + 3)).slice(start);
  const busy = await post(request());
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).error.code, "codex_busy");
  aborts[0].abort();
  await calls[0];
  await bridge.close();
  await Promise.all(calls);
  for (const call of entries) {
    await assertStopped(call.pid);
    await assertStopped(call.descendant);
    await assert.rejects(readdir(call.cwd), { code: "ENOENT" });
  }
});

test("a stalled request body times out before spawning Codex", async (t) => {
  const { base } = await serve(t, { timeoutMs: 50 });
  const count = (await audit()).length;
  const response = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${token}` } }, (res) => {
      res.resume();
      res.once("end", () => { resolve(res.statusCode); req.destroy(); });
    });
    req.once("error", reject);
    req.write('{"model":');
  });
  assert.equal(response, 504);
  assert.equal((await audit()).length, count);
});
