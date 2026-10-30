import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium, firefox } from "playwright-core";
import { attachBrowserSession, browserOperation, finalControl, pageHash } from "./browser/runtime.mjs";
import { isPublicIp, publicAddress, publicUrl, createEgressProxy } from "./browser/network.mjs";
import { executeGmail, gmailUrl, originalHeaders } from "./browser/gmail.mjs";
import { digest } from "./application-worker/tools.mjs";

const browserType = { chromium, firefox }[process.env.BROWSER_TEST_ENGINE || "chromium"];
assert.ok(browserType, "BROWSER_TEST_ENGINE must be chromium or firefox");

test("browser egress rejects private, reserved, mapped and mixed DNS destinations", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.0.5", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1"]) assert.equal(isPublicIp(address), false, address);
  assert.equal(isPublicIp("8.8.8.8"), true);
  assert.equal(isPublicIp("2001:4860:4860::8888"), true);
  for (const url of ["http://127.0.0.1", "http://localhost", "https://x.localhost", "file:///etc/passwd", "https://user:secret@example.org", "https://example.org:8789"]) assert.throws(() => publicUrl(url));
  await assert.rejects(publicAddress("mixed.example", async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]), /Private/);
  const proxy = await createEgressProxy();
  try {
    const status = await new Promise((resolve, reject) => { const request = http.get(proxy.url, { path: "http://127.0.0.1:8789/health" }, (response) => { response.resume(); resolve(response.statusCode); }); request.on("error", reject); });
    assert.equal(status, 403);
  } finally { proxy.close(); }
});

test("Gmail identifiers stay separate from API identifiers and original headers unfold safely", () => {
  assert.equal(gmailUrl("https://mail.google.com/mail/u/0/#inbox/thread123"), "https://mail.google.com/mail/u/0/#all/thread123");
  assert.throws(() => gmailUrl("https://mail.google.com.evil.example/mail/u/0/#inbox/x"));
  assert.deepEqual(originalHeaders("Message-ID: <one@example.org>\r\nReferences: <a@example.org>\r\n <b@example.org>\r\nIn-Reply-To: <a@example.org>\r\n\r\nBody"), { messageId: "<one@example.org>", references: "<a@example.org> <b@example.org>", inReplyTo: "<a@example.org>", date: "" });
  assert.equal(finalControl("Continue", "submit"), false);
  assert.equal(finalControl("Submit application", "button"), true);
  assert.equal(finalControl("Unlabelled", "submit"), true);
});

test("observes optional blanks and frames, fills multiple steps and uploads exact PDF bytes", async (t) => {
  const browser = await browserType.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<label>Name<input name="name" required></label><label>Phone<input name="phone"></label><label>Password<input type="password" value="secret"></label><button type="button" onclick="document.body.innerHTML=\'<label>CV<input type=file required></label><button type=button>Submit application</button>\'">Continue</button>');
  attachBrowserSession("fixture-fill", "portals", page);
  const signal = new AbortController().signal;
  let observation = await browserOperation({}, { command: "observe", sessionId: "fixture-fill" }, signal);
  assert.deepEqual(observation.fields.map((field) => [field.label, field.required, field.value]), [["Name", true, ""], ["Phone", false, ""]]);
  assert.equal(JSON.stringify(observation).includes("secret"), false);
  await browserOperation({}, { command: "fill", sessionId: "fixture-fill", fieldId: observation.fields[0].id, value: "Jane Doe" }, signal);
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Jane Doe");
  observation = await browserOperation({}, { command: "observe", sessionId: "fixture-fill" }, signal);
  await browserOperation({}, { command: "advance", sessionId: "fixture-fill", controlId: observation.controls[0].id }, signal);
  observation = await browserOperation({}, { command: "observe", sessionId: "fixture-fill" }, signal);
  const data = Buffer.from("%PDF-1.4 fixture attachment");
  const part = data.subarray(0, 8);
  await browserOperation({}, { command: "stage", sessionId: "fixture-fill", artifactId: "cv1", fileName: "CV.pdf", size: data.length, offset: 0, data: part.toString("base64"), checksum: digest(data) }, signal);
  await browserOperation({}, { command: "stage", sessionId: "fixture-fill", artifactId: "cv1", fileName: "CV.pdf", size: data.length, offset: 8, data: data.subarray(8).toString("base64"), checksum: digest(data) }, signal);
  await browserOperation({}, { command: "upload", sessionId: "fixture-fill", artifactId: "cv1", fieldId: observation.fields[0].id }, signal);
  assert.equal(await page.locator('input[type="file"]').evaluate((input) => input.files[0].text()), data.toString());
  await assert.rejects(browserOperation({}, { command: "advance", sessionId: "fixture-fill", controlId: observation.controls[0].id }, signal), /Final submission/);
  await browserOperation({}, { command: "close", sessionId: "fixture-fill" }, signal);
});

test("final submission rejects changed values and records intent before one click", async (t) => {
  const browser = await browserType.launch({ headless: true });
  t.after(() => browser.close());
  const directory = await mkdtemp(path.join(tmpdir(), "btalalos-browser-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "browser"));
  const page = await browser.newPage();
  await page.setContent('<label>Name<input value="Jane Doe"></label><button type="button" onclick="window.submissions=(window.submissions||0)+1">Submit application</button>');
  attachBrowserSession("fixture-submit", "portals", page);
  const signal = new AbortController().signal;
  const observation = await browserOperation({}, { command: "observe", sessionId: "fixture-submit" }, signal);
  await page.getByLabel("Name").fill("Changed");
  assert.equal((await browserOperation({ data: directory }, { command: "submit", sessionId: "fixture-submit", controlId: observation.controls[0].id, authorizationHash: pageHash(observation) }, signal)).attempted, false);
  assert.equal(await page.evaluate(() => window.submissions || 0), 0);
  const current = await browserOperation({}, { command: "observe", sessionId: "fixture-submit" }, signal);
  const request = { command: "submit", sessionId: "fixture-submit", controlId: current.controls[0].id, authorizationHash: pageHash(current) };
  await browserOperation({ data: directory }, request, signal);
  assert.equal(await page.evaluate(() => window.submissions), 1);
  const receipt = JSON.parse(await readFile(path.join(directory, "browser/submission-fixture-submit.json")));
  assert.equal(receipt.status, "SUBMITTING");
  const after = await browserOperation({}, { command: "observe", sessionId: "fixture-submit" }, signal);
  await assert.rejects(browserOperation({ data: directory }, { ...request, controlId: after.controls[0].id, authorizationHash: pageHash(after) }, signal), /already attempted/);
  assert.equal(await page.evaluate(() => window.submissions), 1);
  await browserOperation({}, { command: "close", sessionId: "fixture-submit" }, signal);
});

async function gmailFixture(t) {
  const browser = await browserType.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const sessions = new Map();
  const counters = { sends: 0 };
  await context.exposeFunction("recordSend", () => { counters.sends++; });
  const directory = await mkdtemp(path.join(tmpdir(), "btalalos-gmail-"));
  await mkdir(path.join(directory, "browser"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const account = '<a aria-label="Google Account: Jane Doe (jane@gmail.com)">Account</a>';
  await context.route("https://mail.google.com/**", async (route) => {
    const url = new URL(route.request().url());
    let html;
    if (url.searchParams.get("view") === "om") html = '<pre>Message-ID: &lt;fixture@example.org&gt;\nDate: Fri, 30 Oct 2026 10:00:00 +0100\nReferences: &lt;previous@example.org&gt;\n\nCould we talk?</pre>';
    else if (url.searchParams.get("view") === "cm") html = `${account}<div class="M9"><span email="hr@example.org">Recruiter</span><input name="subjectbox" value="Application"><div role="textbox" contenteditable="true"></div><input type="file" name="Filedata"><button type="button" aria-label="Send">Send</button></div><script>document.querySelector('input[type=file]').onchange=()=>{const span=document.createElement('span');span.textContent=document.querySelector('input[type=file]').files[0].name;document.querySelector('.M9').append(span)};document.querySelector('button').onclick=()=>{window.recordSend();window.sent=(window.sent||0)+1;const note=document.createElement('div');note.textContent='Message sent';document.body.append(note);const link=document.createElement('a');link.textContent='View message';link.href='https://mail.google.com/mail/u/0/#sent/thread1';document.body.append(link)}</script>`;
    else html = `${account}<main role="main"><table><tr class="zA"><td><span data-legacy-thread-id="thread1">Application</span></td></tr></table><button type="button" aria-label="Older" disabled>Older</button><h2 class="hP">Application</h2><div class="adn ads"><span class="gD" email="hr@example.org">Recruiter</span><span class="g2" email="jane@gmail.com">Jane</span><div class="a3s aiL">Could we talk?</div><button type="button" aria-label="More">More</button></div></main><script>document.querySelector('[aria-label=More]').onclick=()=>{const item=document.createElement('button');item.setAttribute('role','menuitem');item.textContent='Show original';item.onclick=()=>window.open('https://mail.google.com/mail/u/0/?view=om');document.body.append(item)}</script>`;
    await route.fulfill({ contentType: "text/html", body: html });
  });
  await (await context.newPage()).goto("https://mail.google.com/mail/u/0/#inbox");
  const state = { browser, account: "jane@gmail.com" };
  const invoke = (input) => executeGmail({ data: directory }, state, { account: state.account, ...input }, new AbortController().signal, { sessions });
  return { sessions, state, invoke, directory, counters };
}

test("Gmail browser reads visible threads and RFC identity without an API request", async (t) => {
  const { invoke } = await gmailFixture(t);
  const listed = await invoke({ command: "gmail-list", query: "newer_than:21d" });
  assert.deepEqual(listed.urls, ["https://mail.google.com/mail/u/0/#all/thread1"]);
  const { mails } = await invoke({ command: "gmail-read", threadUrl: listed.urls[0] });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].messageId, "<fixture@example.org>");
  assert.equal(mails[0].date, "2026-10-30T09:00:00.000Z");
  assert.equal(mails[0].text, "Could we talk?");
  assert.equal(mails[0].browserThreadUrl, listed.urls[0]);
});

test("Gmail browser verifies recipients and files before recording one non-replayable send", async (t) => {
  const { invoke, sessions, directory, counters } = await gmailFixture(t);
  await invoke({ command: "gmail-compose", sessionId: "gmail-fixture", to: "hr@example.org", subject: "Application", body: "Hello recruiter" });
  const session = sessions.get("gmail-fixture");
  const bytes = Buffer.from("%PDF-1.4 exact attachment");
  session.files.set("cv", { name: "CV.pdf", mimeType: "application/pdf", buffer: bytes, checksum: digest(bytes) });
  await invoke({ command: "gmail-attach", sessionId: "gmail-fixture", artifactId: "cv" });
  await invoke({ command: "gmail-attach", sessionId: "gmail-fixture", artifactId: "cv" });
  assert.equal(session.mail.attachments.length, 1);
  await assert.rejects(invoke({ command: "gmail-list", query: "newer_than:21d" }), /outgoing message/);
  const snapshot = await invoke({ command: "gmail-observe", sessionId: "gmail-fixture" });
  await session.page.locator(".M9").evaluate((element) => { const extra = document.createElement("span"); extra.setAttribute("email", "other@example.org"); element.append(extra); });
  await assert.rejects(invoke({ command: "gmail-send", sessionId: "gmail-fixture", authorizationHash: digest(JSON.stringify(snapshot)) }), /recipient/);
  await assert.rejects(readFile(path.join(directory, "browser/submission-gmail-fixture.json")), /ENOENT/);
  await session.page.locator('[email="other@example.org"]').evaluate((element) => element.remove());
  const sent = await invoke({ command: "gmail-send", sessionId: "gmail-fixture", authorizationHash: digest(JSON.stringify(snapshot)) });
  assert.equal(sent.sent, true);
  assert.equal(sent.threadUrl, "https://mail.google.com/mail/u/0/#all/thread1");
  await assert.rejects(invoke({ command: "gmail-send", sessionId: "gmail-fixture", authorizationHash: digest(JSON.stringify(snapshot)) }), /already attempted/);
  assert.equal(counters.sends, 1);
});


test("application links are clickable and manual popup login is observed on resume", async (t) => {
  const browser = await browserType.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<label>Search<input></label><a href="#login">Apply now</a>');
  attachBrowserSession("fixture-entry", "portals", page);
  const signal = new AbortController().signal;
  let observed = await browserOperation({}, { command: "observe", sessionId: "fixture-entry" }, signal);
  const apply = observed.controls.find((control) => control.label === "Apply now");
  assert.equal(apply.final, false);
  await browserOperation({}, { command: "advance", sessionId: "fixture-entry", controlId: apply.id }, signal);
  assert.ok(page.url().endsWith("#login"));
  const opened = page.waitForEvent("popup");
  await page.evaluate(() => window.open("about:blank"));
  const popup = await opened;
  await popup.setContent('<label>Application name<input required></label>');
  observed = await browserOperation({}, { command: "observe", sessionId: "fixture-entry" }, signal);
  assert.deepEqual(observed.fields.map((field) => field.label), ["Application name"]);
});

test("nested shadow forms expose nearby labels, hidden upload fields and Next controls", async (t) => {
  const browser = await browserType.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<application-form></application-form>');
  await page.evaluate(() => {
    const root = document.querySelector('application-form').attachShadow({ mode: 'open' });
    root.innerHTML = '<section><span id="caption">Full name</span><input aria-labelledby="caption" onchange="this.dataset.changed=this.value"></section><upload-widget></upload-widget><input type="submit" value="Next" onclick="event.preventDefault();this.value=\'Continue\'">';
    root.querySelector('upload-widget').attachShadow({ mode: 'open' }).innerHTML = '<div><span>Curriculum vitae PDF</span><input type="file" style="display:none"><button>Choose file</button></div>';
  });
  attachBrowserSession("fixture-shadow", "portals", page);
  const signal = new AbortController().signal;
  let observed = await browserOperation({}, { command: "observe", sessionId: "fixture-shadow" }, signal);
  assert.deepEqual(observed.fields.map((field) => field.label), ["Full name", "Curriculum vitae PDF"]);
  assert.match(observed.text, /Full name/);
  await browserOperation({}, { command: "fill", sessionId: "fixture-shadow", fieldId: observed.fields[0].id, value: "Jane Doe" }, signal);
  assert.equal(await page.locator('input[aria-labelledby]').getAttribute('data-changed'), 'Jane Doe');
  const bytes = Buffer.from('%PDF-1.7\nshadow upload');
  await browserOperation({}, { command: 'stage', sessionId: 'fixture-shadow', artifactId: 'shadow-cv', fileName: 'CV.pdf', data: bytes.toString('base64'), size: bytes.length, offset: 0, checksum: digest(bytes) }, signal);
  await browserOperation({}, { command: 'upload', sessionId: 'fixture-shadow', artifactId: 'shadow-cv', fieldId: observed.fields[1].id }, signal);
  assert.equal(await page.locator('input[type=file]').evaluate((input) => input.files[0].text()), bytes.toString());
  const next = observed.controls.find((control) => control.label === 'Next');
  assert.equal(next.final, false);
  observed = await browserOperation({}, { command: 'advance', sessionId: 'fixture-shadow', controlId: next.id }, signal);
  assert.ok(observed.controls.some((control) => control.label === 'Continue'));
});

test("ARIA radio and checkbox values are verified using checked state rather than their label text", async (t) => {
  const browser = await browserType.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div role="radio" tabindex="0" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',\'true\')">Yes</div><div role="checkbox" tabindex="0" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',String(this.getAttribute(\'aria-checked\')!==\'true\'))">Option</div>');
  attachBrowserSession('fixture-aria-state', 'portals', page);
  const signal = new AbortController().signal;
  const observed = await browserOperation({}, { command: 'observe', sessionId: 'fixture-aria-state' }, signal);
  for (const field of observed.fields) {
    const result = await browserOperation({}, { command: 'fill', sessionId: 'fixture-aria-state', fieldId: field.id, value: 'true' }, signal);
    assert.equal(result.actualValue, 'true');
  }
  const checkbox = observed.fields.find((field) => field.type === 'checkbox');
  const result = await browserOperation({}, { command: 'fill', sessionId: 'fixture-aria-state', fieldId: checkbox.id, value: 'false' }, signal);
  assert.equal(result.actualValue, 'false');
  const refreshed = await browserOperation({}, { command: 'observe', sessionId: 'fixture-aria-state' }, signal);
  assert.deepEqual(refreshed.fields.map((field) => field.value), ['true', 'false']);
});

test("custom dropdowns expose associated choices and select values without typing", async (t) => {
  const browser = await browserType.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<label>Currency<input type="text" role="combobox" aria-controls="currencies" aria-expanded="false" readonly onkeydown="if(event.altKey && event.key==='ArrowDown'){document.getElementById('currencies').hidden=false;this.setAttribute('aria-expanded','true')}"></label>
    <div id="currencies" role="listbox" hidden><div role="option" onclick="document.querySelector('input').value='Euro';this.parentElement.hidden=true">Euro</div><div role="option" aria-disabled="true">Disabled</div></div>
    <div role="listbox"><div role="option">Euro</div></div>
    <label>Country<select><option value="">Choose</option><option value="TN">Tunisia</option></select></label>`);
  attachBrowserSession('fixture-dropdown', 'portals', page);
  const signal = new AbortController().signal;
  let observed = await browserOperation({}, { command: 'observe', sessionId: 'fixture-dropdown' }, signal);
  let currency = observed.fields.find((field) => field.label === 'Currency');
  assert.equal(currency.type, 'combobox');
  assert.deepEqual(currency.options, []);
  await assert.rejects(browserOperation({}, { command: 'fill', sessionId: 'fixture-dropdown', fieldId: currency.id, value: 'Euro' }, signal), /Expand/);
  await browserOperation({}, { command: 'expand', sessionId: 'fixture-dropdown', fieldId: currency.id }, signal);
  observed = await browserOperation({}, { command: 'observe', sessionId: 'fixture-dropdown' }, signal);
  currency = observed.fields.find((field) => field.label === 'Currency');
  assert.deepEqual(currency.options, ['Euro']);
  assert.equal(currency.choices.length, 1);
  await assert.rejects(browserOperation({}, { command: 'fill', sessionId: 'fixture-dropdown', fieldId: currency.id, value: 'EUR' }, signal), /exact observed option/);
  assert.deepEqual(await browserOperation({}, { command: 'fill', sessionId: 'fixture-dropdown', fieldId: currency.id, value: 'Euro' }, signal), { actualValue: 'Euro' });
  const country = observed.fields.find((field) => field.label === 'Country');
  assert.deepEqual(await browserOperation({}, { command: 'fill', sessionId: 'fixture-dropdown', fieldId: country.id, value: 'Tunisia' }, signal), { actualValue: 'Tunisia' });
  assert.equal(await page.locator('select').inputValue(), 'TN');
});
