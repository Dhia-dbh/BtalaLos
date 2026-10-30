import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { createEgressProxy, publicUrl } from "./network.mjs";
import { digest, id, requireValue } from "../application-worker/tools.mjs";
import { executeGmail } from "./gmail.mjs";

const states = new Map();
const sessions = new Map();
export function attachBrowserSession(sessionId, profile, page) {
  id(sessionId);
  const session = { id: sessionId, page, profile, refs: new Map(), observation: null };
  sessions.set(sessionId, session);
  const watch = (page) => page.on("popup", (popup) => {
    session.page = popup;
    session.refs = new Map();
    session.observation = null;
    watch(popup);
  });
  watch(page);
  return session;
}
const FINAL = /\b(submit|send|finish|complete application|bewerbung (absenden|senden)|envoyer|soumettre)\b/i;
const NAVIGATION = /\b(next|continue|back|previous|save|weiter|zurück|suivant|continuer)\b/i;
export const finalControl = (label, type) => FINAL.test(label) || (type === "submit" && !NAVIGATION.test(label));
export const pageHash = (page) => digest(JSON.stringify({ url: page.url, fields: page.fields.map(({ label, type, required, value, options, pageUrl }) => ({ label, type, required, value, options, pageUrl })), controls: page.controls.map(({ label, final }) => ({ label, final })) }));

function root(config) { return path.join(config.data, "browser"); }
function profileName(input) { requireValue(["gmail", "portals"].includes(input.profile), "Choose the Gmail or portals profile."); return input.profile; }

async function open(config, input, signal) {
  const name = profileName(input);
  const existing = states.get(name);
  if (existing?.context) return { opened: true, connected: Boolean(existing.connected) };
  if (existing && existing.process.exitCode === null) return { opened: true, connected: Boolean(existing.browser) };
  requireValue(["chromium", "firefox"].includes(config.browserEngine ?? "chromium"), "Choose chromium or firefox for DOSSIER_BROWSER_ENGINE.");
  if (config.browserEngine === "firefox") {
    const { firefox } = await import("playwright-core");
    const directory = path.join(root(config), `${name}-firefox`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const proxy = await createEgressProxy();
    try {
      const context = await firefox.launchPersistentContext(directory, {
        headless: false,
        proxy: { server: proxy.url, bypass: "" },
        firefoxUserPrefs: { "network.proxy.allow_hijacking_localhost": true, "network.proxy.no_proxies_on": "", "media.peerconnection.enabled": false },
        env: { ...Object.fromEntries(["PATH", "HOME", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "PLAYWRIGHT_BROWSERS_PATH"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])), ...(config.browserDisplay ? { DISPLAY: config.browserDisplay } : {}) },
      });
      const state = { context, browser: context.browser(), connected: false, directory, proxy, account: "" };
      states.set(name, state);
      context.on("close", () => { proxy.close(); states.delete(name); for (const [key, session] of sessions) if (session.profile === name) sessions.delete(key); });
      if (name === "gmail") await context.pages()[0].goto("https://mail.google.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
      return { opened: true, connected: false };
    } catch (error) { await states.get(name)?.context?.close(); proxy.close(); throw error; }
  }
  requireValue(config.browserBinary, "Set DOSSIER_BROWSER_BIN to the installed Chrome executable on the host.");
  await access(config.browserBinary, constants.X_OK);
  const directory = path.join(root(config), name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const proxy = await createEgressProxy();
  const child = spawn(config.browserBinary, [
    `--user-data-dir=${directory}`, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
    `--proxy-server=${proxy.url}`, "--proxy-bypass-list=<-loopback>", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--no-first-run", "--no-default-browser-check", name === "gmail" ? "https://mail.google.com/" : "about:blank",
  ], { stdio: "ignore", env: { ...Object.fromEntries(["PATH", "HOME", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])), ...(config.browserDisplay ? { DISPLAY: config.browserDisplay } : {}) } });
  const state = { process: child, directory, proxy, browser: null, account: "" };
  states.set(name, state);
  child.on("exit", () => { proxy.close(); states.delete(name); for (const [key, session] of sessions) if (session.profile === name) sessions.delete(key); });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  await delay(300, undefined, { signal });
  requireValue(child.exitCode === null, "Chrome exited. Check its installation and the host desktop session.");
  return { opened: true, connected: false };
}
async function connect(config, input, signal) {
  const name = profileName(input), state = states.get(name);
  requireValue(state, "Open the dedicated browser first, sign in manually, then connect.");
  if (!state.browser) {
    let port;
    for (let attempt = 0; attempt < 30; attempt++) {
      signal.throwIfAborted();
      try { port = Number((await readFile(path.join(state.directory, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (port) break;
      await delay(200, undefined, { signal });
    }
    requireValue(port > 0, "Chrome did not expose a local debugging endpoint.");
    const { chromium } = await import("playwright-core");
    state.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  }
  const context = state.browser.contexts()[0];
  context.setDefaultTimeout(15_000);
  if (name === "gmail") {
    const page = context.pages().find((page) => page.url().startsWith("https://mail.google.com/"));
    requireValue(page, "Open Gmail and finish signing in before connecting.");
    const label = await page.locator('a[aria-label*="Google Account"], button[aria-label*="Google Account"], a[href*="SignOutOptions"]').first().getAttribute("aria-label");
    const email = label?.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase();
    requireValue(email, "Cannot verify the signed-in Gmail account. Open Gmail in English and finish signing in.");
    state.account = email;
  }
  state.connected = true;
  return { opened: true, connected: true, email: state.account };
}
export async function observe(page) {
  const fields = [], controls = [], links = [];
  const refs = new Map();
  const texts = [];
  let shadowRootCount = 0;
  const token = randomUUID();
  for (const [frameIndex, frame] of page.frames().entries()) {
    const result = await frame.evaluate(({ token, frameIndex, finalPattern, navPattern }) => {
      const roots = [document];
      for (let index = 0; index < roots.length; index++) {
        for (const element of roots[index].querySelectorAll("*")) if (element.shadowRoot) roots.push(element.shadowRoot);
      }
      const visible = (element) => element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
      const resolveId = (element, id) => element.getRootNode().getElementById?.(id) || document.getElementById(id);
      const text = (element) => element?.innerText?.trim() || element?.textContent?.trim() || "";
      const label = (element) => {
        const host = element.getRootNode().host;
        const labelled = (node) => (node?.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map((id) => text(resolveId(node, id))).join(" ").trim();
        const explicit = [...(element.labels || [])].map(text).join(" ") || element.getAttribute("aria-label") || labelled(element)
          || (host && ([...(host.labels || [])].map(text).join(" ") || host.getAttribute("aria-label") || labelled(host)));
        if (explicit) return explicit;
        if (element.matches('button,a,[role="button"],[role="option"],input[type="submit"],input[type="button"]')) return text(element) || element.value || element.getAttribute("title") || element.getAttribute("name") || "Unlabelled control";
        let current = element;
        let container = element.parentElement || host;
        for (let level = 0; container && level < 4; level++, current = container, container = container.parentElement || container.getRootNode().host) {
          const preceding = current.previousElementSibling;
          if (preceding && !preceding.matches(selector) && !preceding.querySelector(selector) && text(preceding).length <= 300 && text(preceding)) return text(preceding);
          const caption = container.querySelector('label,legend,[slot="label"],.sapMLabel');
          if (caption && text(caption)) return text(caption);
          const nearby = [...container.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent.trim()).filter(Boolean).join(" ");
          if (nearby && nearby.length <= 300) return nearby;
        }
        return element.getAttribute("placeholder") || element.getAttribute("title") || element.getAttribute("name") || "Unlabelled field";
      };
      const selector = 'input,textarea,select,[contenteditable="true"],button,[role="button"],a[href],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="option"]';
      const fields = [], controls = [];
      const combos = [];
      let index = 0;
      for (const root of roots) for (const element of root.querySelectorAll(selector)) {
        const upload = element.type === "file";
        if ((!visible(element) && !(upload && visible(element.parentElement || root.host))) || element.disabled || element.getAttribute("aria-disabled") === "true" || element.type === "hidden") continue;
        if (element.shadowRoot?.querySelector(selector)) continue;
        if (element.getAttribute("role") === "combobox" && element.querySelector('input,select,textarea')) continue;
        const widget = element.closest('[role="combobox"]') || element.getRootNode().host;
        const combo = element.tagName !== "SELECT" && (element.getAttribute("role") === "combobox" || widget?.getAttribute("role") === "combobox" || element.getAttribute("aria-haspopup") === "listbox" || ["list", "both"].includes(element.getAttribute("aria-autocomplete")));
        const id = `${token}-${frameIndex}-${index++}`;
        element.setAttribute("data-btalalos-ref", id);
        const type = combo ? "combobox" : element.tagName === "BUTTON" && !element.form ? "button" : element.type || element.getAttribute("role") || element.tagName.toLowerCase();
        const name = label(element).slice(0, 500);
        if (combo) combos.push({ element, widget, id });
        if (type === "password" || /\b(otp|one.?time|verification|security code|authenticator)\b/i.test(name)) continue;
        if (element.tagName === "A" || element.tagName === "BUTTON" || ["submit", "button", "reset", "option"].includes(type) || element.getAttribute("role") === "button") {
          element.setAttribute("data-btalalos-label", name);
          controls.push({ id, label: name, final: new RegExp(finalPattern, "i").test(name) || (type === "submit" && !new RegExp(navPattern, "i").test(name)) });
        } else {
          const context = text(element.closest('fieldset,[role="group"]')?.querySelector('legend,[role="heading"]')).slice(0, 500);
          fields.push({ id, label: name, context, type, required: element.required || element.getAttribute("aria-required") === "true", value: ["checkbox", "radio"].includes(type) ? String(element.checked ?? element.getAttribute("aria-checked") === "true") : element.tagName === "SELECT" ? [...element.selectedOptions].map((option) => option.label).join(", ") : upload ? [...element.files].map((file) => file.name).join(", ") : element.value ?? element.textContent ?? "", options: element.tagName === "SELECT" ? [...element.options].map((option) => option.label) : [], pageUrl: location.href, valid: element.validity ? element.validity.valid : element.getAttribute("aria-invalid") !== "true" });
        }
      }
      for (const { element, widget, id } of combos) {
        const field = fields.find((field) => field.id === id);
        if (!field) continue;
        const ids = [element, widget].filter(Boolean).flatMap((node) => [node.getAttribute("aria-controls"), node.getAttribute("aria-owns")]).filter(Boolean).join(" ").split(/\s+/);
        const popups = ids.map((id) => resolveId(element, id)).filter(Boolean);
        const options = roots.flatMap((root) => [...root.querySelectorAll('[role="option"]')]).filter((option) => visible(option) && option.getAttribute("aria-disabled") !== "true" && popups.some((popup) => popup.contains(option) || popup.contains(option.getRootNode().host)));
        field.choices = options.map((option) => ({ id: option.getAttribute("data-btalalos-ref"), label: label(option) })).filter((choice) => choice.id);
        field.options = field.choices.map((choice) => choice.label);
      }
      return { fields, controls, shadowRootCount: roots.length - 1, links: roots.flatMap((root) => [...root.querySelectorAll("a[href]")]).filter(visible).map((link) => ({ label: text(link).slice(0, 300), url: link.href })).filter((link) => /^https?:/.test(link.url)), text: [document.body?.innerText || "", ...roots.slice(1).filter((root) => visible(root.host)).map((root) => [...root.children].filter(visible).map((node) => node.innerText || "").join("\n"))].join("\n").slice(0, 30_000) };

    }, { token, frameIndex, finalPattern: FINAL.source, navPattern: NAVIGATION.source });
    for (const field of [...result.fields, ...result.controls]) refs.set(field.id, frame.locator(`[data-btalalos-ref="${field.id}"]`));
    fields.push(...result.fields); controls.push(...result.controls); links.push(...result.links); texts.push(result.text);
    shadowRootCount += result.shadowRootCount;
  }
  return { observation: { url: page.url(), title: await page.title(), text: texts.join("\n").slice(0, 30_000), fields, controls, links, diagnostics: { frameCount: page.frames().length, shadowRootCount } }, refs };
}
export async function browserOperation(config, input, signal) {
  if (input.command === "open") return open(config, input, signal);
  if (input.command === "connect") return connect(config, input, signal);
  if (input.command === "status") {
    const state = states.get(profileName(input));
    return { opened: Boolean(state), connected: Boolean(state?.connected && state?.browser?.isConnected()), email: state?.account || "" };
  }
  if (input.command === "start") {
    id(input.sessionId);
    const profile = profileName(input), state = states.get(profile);
    requireValue(state?.connected && state?.browser?.isConnected(), "Connect the dedicated host browser in Settings first.");
    requireValue(![...sessions.values()].some((session) => session.profile === profile && session.id !== input.sessionId), "This browser profile already has an active run. Finish or cancel it first.");
    if (!sessions.has(input.sessionId)) {
      const page = await state.browser.contexts()[0].newPage();
      await page.goto(publicUrl(input.url).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
      attachBrowserSession(input.sessionId, profile, page);
    }
    return { sessionId: input.sessionId };
  }
  if (input.command?.startsWith("gmail-")) {
    const state = states.get("gmail");
    requireValue(state?.browser?.isConnected() && state.account, "Connect your signed-in Gmail browser in Settings first.");
    requireValue(!input.account || input.account.toLowerCase() === state.account, "The Gmail account changed. Review the sender in Settings.");
    return executeGmail(config, state, input, signal, { sessions, observe });
  }
  const session = sessions.get(input.sessionId);
  requireValue(session && !session.page.isClosed(), "The browser session ended. Resume to reopen and inspect it.");
  signal.throwIfAborted();
  if (input.command === "close") { await session.page.close(); sessions.delete(input.sessionId); return { closed: true }; }
  if (input.command === "observe") {
    const result = await observe(session.page);
    Object.assign(session, result);
    return result.observation;
  }
  if (input.command === "stage") {
    const bytes = Buffer.from(input.data, "base64");
    requireValue(bytes.length <= 1024 * 1024 && Number.isInteger(input.size) && input.size <= 200 * 1024 * 1024 && input.size > 0, "Invalid PDF upload size.");
    requireValue(typeof input.fileName === "string" && /^[^/\\\x00-\x1f]+\.pdf$/i.test(input.fileName), "Invalid PDF filename.");
    session.staging ??= new Map();
    const artifactId = id(input.artifactId);
    if (input.offset === 0) session.staging.set(artifactId, { parts: [], size: 0 });
    const staging = session.staging.get(artifactId);
    requireValue(staging && staging.size === input.offset && staging.size + bytes.length <= input.size, "Upload chunks are out of order.");
    staging.parts.push(bytes);
    staging.size += bytes.length;
    if (staging.size !== input.size) return { staged: false, offset: staging.size };
    const buffer = Buffer.concat(staging.parts);
    requireValue(digest(buffer) === input.checksum && buffer.subarray(0, 5).toString() === "%PDF-", "PDF checksum mismatch.");
    session.files ??= new Map();
    session.files.set(artifactId, { name: input.fileName, mimeType: "application/pdf", buffer, checksum: input.checksum });
    session.staging.delete(artifactId);
    return { staged: true };
  }
  if (input.command === "navigate") {
    requireValue(session.observation?.links.some((link) => link.url === input.url), "Navigation must use an observed page link.");
    await session.page.goto(publicUrl(input.url).href, { waitUntil: "domcontentloaded" });
    return { url: session.page.url() };
  }
  if (input.command === "submit") {
    const index = session.observation?.controls.findIndex((control) => control.id === input.controlId) ?? -1;
    const fresh = await observe(session.page);
    Object.assign(session, fresh);
    if (index < 0 || !fresh.observation.controls[index]?.final || input.authorizationHash !== pageHash(fresh.observation) || fresh.observation.fields.some((field) => field.valid === false)) return { attempted: false, observation: fresh.observation, reason: "The reviewed page changed or contains invalid fields. Review it again before submission." };
    input = { ...input, controlId: fresh.observation.controls[index].id };
  }
  const locator = session.refs.get(input.fieldId || input.controlId);
  requireValue(locator && await locator.count() === 1, "The page changed. Inspect it again before acting.");
  if (input.command === "expand") {
    const field = session.observation.fields.find((field) => field.id === input.fieldId);
    requireValue(field?.type === "combobox", "Choose an observed custom dropdown to expand.");
    const expanded = await locator.evaluate((element) => element.getAttribute("aria-expanded") === "true" || element.closest('[role="combobox"]')?.getAttribute("aria-expanded") === "true");
    if (!expanded) await locator.press("Alt+ArrowDown");
    return { expanded: true };
  }
  if (input.command === "fill") {
    const field = session.observation.fields.find((field) => field.id === input.fieldId);
    requireValue(field && field.type !== "file" && typeof input.value === "string", "Invalid field value.");
    if (["checkbox", "radio"].includes(field.type)) { requireValue(["true", "false"].includes(input.value), "Use true or false for this control."); await locator.setChecked(input.value === "true"); }
    else if (field.type === "combobox") {
      const choices = (field.choices || []).filter((choice) => choice.label === input.value);
      requireValue(choices.length === 1, `Expand "${field.label}" and select one exact observed option; the requested option is missing or ambiguous.`);
      const option = session.refs.get(choices[0].id);
      requireValue(option && await option.count() === 1, "The dropdown options changed. Inspect the page again.");
      await option.click();
    }
    else if (await locator.evaluate((element) => element.tagName === "SELECT")) await locator.selectOption({ label: input.value });
    else { await locator.fill(input.value); await locator.blur(); }
    const actualValue = await locator.evaluate((element) => ["checkbox", "radio"].includes(element.type || element.getAttribute("role")) ? String(element.checked ?? element.getAttribute("aria-checked") === "true") : element.tagName === "SELECT" ? [...element.selectedOptions].map((option) => option.label).join(", ") : element.value ?? element.textContent ?? "");
    requireValue(actualValue === input.value, `The portal did not retain the requested value for "${field.label}" (${field.type}).`);
    return { actualValue };
  }
  if (input.command === "upload") {
    requireValue(session.observation.fields.some((field) => field.id === input.fieldId && field.type === "file"), "Choose an observed upload field.");
    const file = session.files?.get(input.artifactId);
    requireValue(file, "Stage the selected document before uploading.");
    await locator.setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
    return { actualValue: await locator.evaluate((element) => [...element.files].map((file) => file.name).join(", ")) };
  }
  if (input.command === "advance" || input.command === "submit") {
    const control = session.observation.controls.find((control) => control.id === input.controlId);
    requireValue(control, "Choose an observed control.");
    requireValue(input.command === "submit" || !control.final, "Final submission requires the submit operation.");
    if (input.command === "submit") {
      const receipt = path.join(root(config), `submission-${id(input.sessionId)}.json`);
      try { await writeFile(receipt, JSON.stringify({ status: "SUBMITTING", at: new Date().toISOString(), url: session.page.url() }), { mode: 0o600, flag: "wx" }); }
      catch (error) { if (error.code === "EEXIST") throw new Error("A submission was already attempted. Reconcile its result before another attempt."); throw error; }
    }
    if (input.command === "advance") {
      const current = await locator.evaluate((element) => ({ label: element.getAttribute("aria-label") || element.innerText?.trim() || element.value || element.getAttribute("title") || element.getAttribute("data-btalalos-label") || element.getAttribute("name") || "Unlabelled control", type: element.tagName === "BUTTON" && !element.form ? "button" : element.type }));
      requireValue(!finalControl(current.label, current.type) && current.label === control.label, "The navigation control changed. Inspect the page again.");
    }
    await locator.click();
    await session.page.waitForLoadState("domcontentloaded");
    const result = await observe(session.page);
    Object.assign(session, result);
    return result.observation;
  }
  throw new Error("Unsupported browser command.");
}

export async function closeBrowsers() {
  for (const state of [...states.values()]) { if (state.context) await state.context.close(); else state.process.kill("SIGTERM"); state.proxy.close(); }
  states.clear();
  sessions.clear();
}
