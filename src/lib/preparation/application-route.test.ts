import { expect, it } from "vitest";
import { analysisSchema } from "./types";
import { applicationLinks, verifyApplicationRoute } from "./application-route";

const analysis = analysisSchema.parse({
  title: null, company: "Example", role: "Researcher", location: null,
  mode: null, salary: null, deadline: null, externalJobId: null,
  recruiterName: null, recruiterEmail: null, applicationMethod: null,
  applicationUrl: null, keywords: [], requirements: [],
});
const url = "https://careers.example.org/apply/42";

it("reads explicit text, Markdown, and HTML destinations, resolving relative links", () => {
  expect(applicationLinks(`Apply here: ${url}. [Click here](${url}) <a href="/apply/42">Apply online</a>`, "https://careers.example.org/jobs/42"))
    .toEqual([url]);
  expect(applicationLinks('<a href="javascript:alert(1)">Apply</a> <a href="/apply">Here</a>'))
    .toEqual([]);
});

it("discards an invented email while retaining verified portal instructions", () => {
  const posting = `Researcher at Example. Apply here: ${url}`;
  expect(verifyApplicationRoute({ ...analysis, recruiterEmail: "guessed@example.org", applicationUrl: url, applicationInstructions: `Apply here: ${url}` }, posting))
    .toMatchObject({ recruiterEmail: null, applicationUrl: url, applicationInstructions: `Apply here: ${url}`, warnings: [expect.stringContaining("email")] });
});

it("keeps a published or manually supplied email and accepts missing contact details", () => {
  expect(verifyApplicationRoute({ ...analysis, recruiterEmail: "hr@example.org" }, "Apply to HR@example.org."))
    .toMatchObject({ recruiterEmail: "hr@example.org", warnings: [] });
  expect(verifyApplicationRoute(analysis, "Researcher at Example", undefined, { recruiterEmail: "manual@example.org" }))
    .toMatchObject({ recruiterEmail: "manual@example.org", warnings: [] });
  expect(verifyApplicationRoute(analysis, "Researcher at Example. Click here to apply."))
    .toMatchObject({ recruiterEmail: null, applicationUrl: null, warnings: [expect.stringContaining("No verified")] });
});

it.each(["https://invented.example.org/apply", "https://careers.example.org/apply/4", "javascript:alert(1)", "https://user:password@careers.example.org/apply/42"])("rejects unsupported application destinations: %s", (applicationUrl) => {
  expect(verifyApplicationRoute({ ...analysis, applicationUrl, applicationInstructions: "Invented instructions" }, `Apply here: ${url}`))
    .toMatchObject({ applicationUrl: null, applicationInstructions: null, warnings: expect.arrayContaining([expect.stringContaining("link")]) });
});
