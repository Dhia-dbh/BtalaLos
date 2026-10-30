# Browser applications and Gmail

Browser automation is optional. The Gmail API remains available. Google Calendar continues to use its existing API connection.

## Host setup

The interactive browser runs on the Linux host desktop, outside the app and preparation containers. Choose Firefox or Chrome explicitly using `DOSSIER_BROWSER_ENGINE`. Chrome is the default. Install the checkout's pinned dependencies on the host with `corepack yarn install --immutable`; the host companion now loads `playwright-core` when connecting a browser. The worker image does not need Chrome or browser credentials.

For Firefox, install the build pinned by this checkout and configure the existing host companion (or all-host worker) environment file:

```sh
PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/browser-cache corepack yarn playwright install firefox
```

```dotenv
DOSSIER_BROWSER_ENGINE=firefox
PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/browser-cache
```

Playwright requires its patched Firefox build; `/usr/bin/firefox` is not compatible. This installation leaves the everyday Firefox browser and profile separate. Firefox opens a visible persistent context; **Connect** authorizes its use after manual sign-in. Firefox traffic uses the same checked proxy, including loopback destinations, with WebRTC disabled. Profile directories have a `-firefox` suffix to keep them separate from Chrome profiles.

For Chrome, add the browser executable to the environment file:

```dotenv
DOSSIER_BROWSER_BIN=/usr/bin/google-chrome-stable
# Only if the desktop display is not already available to the service:
# DOSSIER_BROWSER_DISPLAY=:1
```

Use the actual executable path from your installation. Restart the host companion after changing its environment or code. For the all-host preparation worker, set `DOSSIER_BROWSER_BIN` in that worker's environment instead. Keep the existing worker/host URLs and private tokens. No new public port is required.

The runtime creates separate `gmail` and `portals` profiles under `<host data directory>/browser`. Do not point automation at your everyday Chrome profile. For Chrome, the companion starts normal, visible Chrome without Playwright's automated launch flags, then attaches through a loopback CDP connection after you press **Connect**. Browser traffic uses a local forward proxy that rejects private/reserved destinations and pins checked DNS results when opening connections. Chrome's debugging port remains local.

In **Settings → Browser and email automation**:

1. Enable browser automation and save.
2. Under **Host browsers**, open the portals browser and connect it. Account registration, passwords, MFA, and CAPTCHA are completed manually in the host browser when needed.
3. For Gmail, open its browser, sign in yourself, and then press **Connect**. Use Gmail's English interface. Check that the verified sender address is correct.

Google explicitly lists automation-controlled browsers as a reason it may reject sign-in. A dedicated manually authenticated Chrome profile is the supported setup here, but it does not guarantee Google will accept the account. There is no stealth mode, weakened browser sandbox, or automatic switch to the API. If sign-in remains blocked, the UI reports the failure and the API option stays selectable. See [Google's supported-browser guidance](https://support.google.com/accounts/answer/7675428?hl=en) and [Chrome's non-default profile requirement](https://developer.chrome.com/blog/remote-debugging-port).

## Browser AI

The browser has its own CLI/provider, endpoint, model, and thinking setting. These settings do not change the document-generation model. Select the same model explicitly if you want to reuse it.

The host CLI options use the existing Codex or Claude login. Local providers support Ollama, OpenAI-compatible servers, and LM Studio. Load the available models before choosing a thinking setting. Ollama and LM Studio expose model-specific reasoning capabilities; models without advertised controls use **Model default**. Unsupported explicit settings are rejected rather than silently dropped. Existing document-task thinking behavior remains unchanged.

Playwright executes validated operations. The AI receives page text, observed links, form fields and controls, applicant evidence, prepared document metadata/text, and your answers. It returns structured actions, not JavaScript to execute.

## Portal applications

Posting extraction is shared between native and LaTeX document modes. Verified portal instructions take precedence over email. Recruiter email addresses remain available for optional outreach.

Preparation starts portal automation when enabled and a portal route is detected, or when no application email was verified. You can also choose **Apply through portal** on the preparation screen. A document package is required.

If pasted text lost a “click here” destination, automation opens the saved original posting URL and follows observed links. It keeps the pasted posting separately from retrieved page evidence. Without a posting or portal URL, it pauses for one in BtalaLos. If the destination does not show the expected company and role, it asks you to confirm that exact page before entering applicant information.

The browser handles multiple pages, common input controls, frames, and file inputs. It chooses the merged package, individual CV/letter PDFs, or supporting PDFs according to the instructions and upload fields. Documents remain tied to their saved artifact versions and checksums. Unknown required facts, ambiguous controls, invalid fields, login, and verification pause automation. Optional fields without supported values stay empty and remain visible in the audit record.

**Review** mode fills the portal and advances through intermediate pages. It then shows the accumulated fields and documents in **Automation** and the application's preparation screen. **Approve and submit** authorizes the final action. Portals can save intermediate steps before that approval. **Automatic** mode performs the final action after the required fields are ready.

Use **Answer or correction**, save it, and resume when the browser requests information. Saving a correction invalidates the previous approval. An expired browser session requires reconnecting and explicitly resuming; it is not replayed automatically.

## Gmail and replies

Choose **Gmail API** or **Playwright browser** in the automation settings. Browser mode reads messages and sends application emails/replies through Gmail's visible UI without Gmail API authentication. The Gmail browser must remain connected. Only one outgoing Gmail run holds that profile at a time; inbox reading waits until that run is finished or cancelled.

Both backends support **Manual only** or **Scheduled** reading, plus **Read now**. Each exclusion rule has one or more literal phrases and a Subject, Body, or Both target. Any case-insensitive match excludes a message before import, classification, or drafting. The last reading's skipped counts and rule IDs are shown in Settings. Exclusion does not archive, delete, or label the Gmail message.

Enable **Automatically draft replies that need an answer** to draft replies to linked questions, interview invitations, and offers. Rejections and automatic acknowledgements are skipped. Reply submission has a separate Review/Automatic setting. Missing answers, unresolved placeholders, or unverified claims prevent automatic sending. The existing manual draft/edit/send controls remain available.

Gmail browser reading currently scans at most 200 recent threads over 21 days and requires the English Gmail layout. Browser selectors are an integration with Gmail's current UI, not a stable Google API contract. Account changes, missing message headers, unrecognized layouts, and missing confirmation stop the affected operation explicitly. API/browser message identifiers are kept separate; RFC Message-ID and mailbox identity reconcile messages when changing backends.

## Recruiter outreach and prompts

For a portal application, **Draft recruiter outreach** creates an editable short email using verified recruiter contacts and candidate evidence. It does not claim online submission until the portal run is confirmed. Attachments start unselected; choose them explicitly. Outreach always requires review, through the selected mail backend, and does not count as a second job application.

The default suggests 80–120 words, a specific subject, the role/reference, and one or two supported reasons for fit. It follows [Stanford's advice on brief, specific outreach](https://www.gsb.stanford.edu/alumni/career-resources/job-search/networking/email-best-practices) and [Berkeley's guidance to follow employer instructions](https://hr.berkeley.edu/node/5835). The word range is an editable product default.

**Settings → Prompts** contains the routing, browser filling, classification, reply, and outreach instructions alongside the existing document prompts. Output schemas, source-integrity requirements, and submission controls are enforced separately from editable prose.

## Traceability and uncertain outcomes

Each run keeps settings, prompts, proposed actions, observed pages, fields and their sources, optional blanks, document versions/checksums, timestamps, approvals, and outcome evidence. Download the Markdown report from the run card. Credentials, browser cookies, and authentication codes are not collected as applicant fields.

Submission intent is saved before the final action. The host also writes a private receipt before a portal click or Gmail send. If the connection is lost after an attempt, the run becomes **Uncertain** and cannot be resumed or retried. Check the portal or Gmail Sent, then record evidence and confirm whether submission occurred. A confirmed failure resolves the old run; start a fresh run explicitly if needed.

Application exports include browser-run history. Imports preserve history but cancel executable pending runs and remove their approvals. Browser profiles, host receipts, connection state, and browser API keys are not included. Back up host browser data separately if you need it. Deleting an application's record deletes its database audit history; host browser profiles and submission receipts remain on the host.

## Validation

```sh
corepack yarn test:browser
BROWSER_TEST_ENGINE=firefox corepack yarn test:browser
corepack yarn vitest run --project db src/lib/browser/service.db.test.ts
corepack yarn vitest run --project node src/lib/browser/mail-filters.test.ts
corepack yarn test:e2e e2e/browser-automation.spec.ts
```

Runtime tests use synthetic forms and mail fixtures. They do not send real email or apply to a real vacancy. Live acceptance additionally requires your manual Google login, a portal filled up to review, and a controlled mailbox send/read/reply check.
