import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { digest, id, requireValue } from "../application-worker/tools.mjs";

const ORIGIN = "https://mail.google.com";
export function gmailUrl(value) {
  const url = new URL(value);
  requireValue(url.origin === ORIGIN && /^\/mail\/u\/\d+\//.test(url.pathname), "Use a Gmail thread URL from the connected account.");
  const thread = url.hash.match(/^#(?:all|inbox|sent|imp|starred)\/([^/?]+)$/)?.[1];
  if (thread) url.hash = `#all/${thread}`;
  return url.href;
}
export function originalHeaders(raw) {
  const header = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, " ");
  const value = (name) => header.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() || "";
  return { messageId: value("Message-ID"), references: value("References"), inReplyTo: value("In-Reply-To"), date: value("Date") };
}
async function checkAccount(page, account) {
  const label = await page.locator('a[aria-label*="Google Account"], button[aria-label*="Google Account"], a[href*="SignOutOptions"]').first().getAttribute("aria-label");
  requireValue(label?.toLowerCase().includes(account.toLowerCase()), "The Gmail account could not be verified. Sign in again from Settings.");
}
function mailbox(state) {
  const page = state.browser.contexts()[0].pages().find((page) => page.url().startsWith(`${ORIGIN}/mail/`));
  requireValue(page, "Open the signed-in Gmail mailbox first.");
  return new URL(page.url()).pathname.match(/^\/mail\/u\/\d+\//)?.[0] || "/mail/u/0/";
}
async function threadLinks(page) {
  return page.locator("tr.zA").evaluateAll((rows) => rows.map((row) => {
    const thread = row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id");
    return thread ? `${location.origin}${location.pathname}#all/${thread}` : row.querySelector('a[href*="#"]')?.href;
  }).filter(Boolean));
}
export async function executeGmail(config, state, input, signal, { sessions }) {
  const context = state.browser.contexts()[0];
  signal.throwIfAborted();
  if (input.command === "gmail-list") {
    requireValue(![...sessions.values()].some((session) => session.profile === "gmail"), "Gmail is preparing an outgoing message. Finish or cancel it before reading mail.");
    const page = await context.newPage();
    try {
      await page.goto(`${ORIGIN}${mailbox(state)}#search/${encodeURIComponent(input.query)}`, { waitUntil: "domcontentloaded" });
      await checkAccount(page, state.account);
      await page.locator('[role="main"]').waitFor();
      await page.waitForFunction(() => document.querySelector("tr.zA") || /No conversations found|Your inbox is empty/.test(document.querySelector('[role="main"]')?.textContent || ""));
      const urls = new Set();
      for (let batch = 0; batch < 20 && urls.size < 200; batch++) {
        signal.throwIfAborted();
        await page.locator('tr.zA, [role="main"]').first().waitFor();
        for (const url of await threadLinks(page)) urls.add(gmailUrl(url));
        const next = page.getByRole("button", { name: "Older", exact: true });
        if (await next.count() !== 1 || !await next.isEnabled()) break;
        const before = [...urls].join("\n");
        await next.click();
        await page.waitForFunction((before) => [...document.querySelectorAll("tr.zA [data-legacy-thread-id]")].some((element) => !before.includes(element.getAttribute("data-legacy-thread-id"))), before);
      }
      return { urls: [...urls].slice(0, 200), email: state.account };
    } finally { await page.close(); }
  }
  if (input.command === "gmail-read") {
    const page = await context.newPage();
    try {
      await page.goto(gmailUrl(input.threadUrl), { waitUntil: "domcontentloaded" });
      await checkAccount(page, state.account);
      await page.locator(".adn.ads").first().waitFor();
      const mails = [];
      const subject = await page.locator("h2.hP").innerText();
      const messages = page.locator(".adn.ads");
      for (let index = 0; index < await messages.count(); index++) {
        signal.throwIfAborted();
        const message = messages.nth(index);
        const body = message.locator(".a3s.aiL");
        if (!await body.isVisible()) await message.locator(".gE.iv.gt").click();
        const sender = message.locator(".gD[email]").first();
        const fromAddress = await sender.getAttribute("email");
        const fromName = await sender.innerText();
        const to = await message.locator(".g2[email]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("email")).join(", "));
        const popup = page.waitForEvent("popup");
        await message.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menuitem", { name: "Show original", exact: true }).click();
        const original = await popup;
        let headers;
        try {
          await original.waitForLoadState("domcontentloaded");
          headers = originalHeaders(await original.locator("pre").innerText());
        } finally { await original.close(); }
        requireValue(headers.messageId, "Gmail did not expose the message's RFC Message-ID. No message was imported.");
        const sentAt = new Date(headers.date);
        requireValue(!Number.isNaN(sentAt.getTime()), "Gmail did not expose a valid message date in Show original.");
        const text = await body.innerText();
        mails.push({ id: `browser:${digest(`${state.account}:${headers.messageId}`)}`, threadId: `browser:${digest(input.threadUrl)}`, browserMessageId: headers.messageId, browserThreadUrl: input.threadUrl, from: `${fromName} <${fromAddress}>`, to, subject, messageId: headers.messageId, references: headers.references, date: sentAt.toISOString(), text, labels: [fromAddress?.toLowerCase() === state.account ? "SENT" : "INBOX"] });
      }
      return { mails };
    } finally { await page.close(); }
  }
  if (input.command === "gmail-compose") {
    id(input.sessionId);
    requireValue(![...sessions.values()].some((session) => session.profile === "gmail" && session.id !== input.sessionId), "Finish or cancel the active Gmail message first.");
    if (sessions.has(input.sessionId)) return { prepared: true };
    const page = await context.newPage();
    try {
      if (input.threadUrl) {
        await page.goto(gmailUrl(input.threadUrl), { waitUntil: "domcontentloaded" });
        await checkAccount(page, state.account);
        await page.getByRole("button", { name: /^Reply( to .*)?$/ }).last().click();
      } else {
        const url = new URL(`${ORIGIN}${mailbox(state)}`);
        for (const [key, value] of Object.entries({ view: "cm", fs: "1", to: input.to, su: input.subject, body: input.body })) url.searchParams.set(key, value);
        await page.goto(url.href, { waitUntil: "domcontentloaded" });
        await checkAccount(page, state.account);
      }
      const editor = page.locator('[contenteditable="true"][role="textbox"]');
      await editor.first().waitFor();
      requireValue(await editor.count() === 1, "Gmail must have exactly one active message editor.");
      await editor.fill(input.body);
      const scope = page.locator(input.threadUrl ? ".ip.adB" : ".M9").filter({ has: editor });
      requireValue(await scope.count() === 1, "Gmail's active message could not be isolated.");
      sessions.set(input.sessionId, { id: input.sessionId, page, scope, profile: "gmail", files: new Map(), mail: { to: input.to, subject: input.subject, body: input.body, threadUrl: input.threadUrl || null } });
      return { prepared: true };
    } catch (error) { await page.close(); throw error; }
  }
  const session = sessions.get(input.sessionId);
  requireValue(session?.profile === "gmail" && !session.page.isClosed(), "The Gmail message session ended. Resume to prepare it again.");
  if (input.command === "gmail-send") {
    const receipt = path.join(config.data, "browser", `submission-${id(input.sessionId)}.json`);
    const attempted = await readFile(receipt).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
    requireValue(!attempted, "A send was already attempted. Check Sent before trying again.");
  }
  const page = session.page;
  await checkAccount(page, state.account);
  if (input.command === "gmail-attach") {
    const file = session.files.get(input.artifactId);
    requireValue(file, "Stage the attachment first.");
    if ((session.mail.attachments ?? []).some((attachment) => attachment.fileName === file.name && attachment.checksum === file.checksum)) {
      requireValue(await session.scope.getByText(file.name, { exact: true }).count() === 1, "The previously uploaded attachment changed. Edit and reprepare this message.");
      return { attached: true };
    }
    const uploads = page.locator('input[type="file"][name="Filedata"]');
    requireValue(await uploads.count() === 1, "Gmail's attachment field could not be identified.");
    await uploads.setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
    await page.getByText(file.name, { exact: true }).first().waitFor();
    await page.locator('[role="progressbar"]').waitFor({ state: "hidden" });
    session.mail.attachments ??= [];
    session.mail.attachments.push({ fileName: file.name, checksum: file.checksum });
    return { attached: true };
  }
  if (input.command === "gmail-observe" || input.command === "gmail-send") {
    const body = await page.locator('[contenteditable="true"][role="textbox"]').innerText();
    const recipients = await session.scope.locator('span[email], [data-hovercard-id]').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute("email") || node.getAttribute("data-hovercard-id")).filter((value) => value?.includes("@")))]);
    requireValue(recipients.length === 1 && recipients.includes(session.mail.to.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0]), "Gmail's recipient does not match the prepared message.");
    const subjectInput = page.locator('input[name="subjectbox"]');
    const subject = await subjectInput.count() === 1 ? await subjectInput.inputValue() : await page.locator("h2.hP").innerText();
    requireValue(subject.replace(/^Re:\s*/i, "") === session.mail.subject.replace(/^Re:\s*/i, "") && body.trim() === session.mail.body.trim(), "The Gmail message changed. Review it again.");
    for (const attachment of session.mail.attachments ?? []) requireValue(await session.scope.getByText(attachment.fileName, { exact: true }).count() === 1, "A reviewed attachment was removed or changed.");
    requireValue(await session.scope.locator('[role="progressbar"]').count() === 0, "Wait for attachments to finish uploading.");
    const snapshot = { ...session.mail, body, subject, account: state.account };
    if (input.command === "gmail-observe") return snapshot;
    requireValue(input.authorizationHash === digest(JSON.stringify(snapshot)), "Gmail submission must match the reviewed message.");
    const receipt = path.join(config.data, "browser", `submission-${id(input.sessionId)}.json`);
    try { await writeFile(receipt, JSON.stringify({ status: "SUBMITTING", at: new Date().toISOString() }), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code === "EEXIST") throw new Error("A send was already attempted. Check Sent before trying again."); throw error; }
    await page.getByRole("button", { name: /^Send(?: \(.*\))?$/ }).first().click();
    await page.getByText("Message sent", { exact: true }).waitFor({ timeout: 20_000 });
    const view = page.getByRole("link", { name: "View message", exact: true });
    let threadUrl = session.mail.threadUrl;
    if (await view.count() === 1) { await view.click(); threadUrl = gmailUrl(page.url()); }
    return { sent: true, threadUrl, evidence: "Gmail displayed Message sent.", id: `browser-send:${input.sessionId}`, threadId: threadUrl ? `browser:${digest(threadUrl)}` : `browser-send:${input.sessionId}` };
  }
  throw new Error("Unsupported Gmail command.");
}
