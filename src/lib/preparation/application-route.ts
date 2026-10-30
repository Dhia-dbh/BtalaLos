import { parse } from "node-html-parser";
import type { z } from "zod";
import { emailAddresses } from "@/lib/application-email";
import type { analysisSchema } from "./types";

export function applicationLinks(posting: string, baseUrl?: string): string[] {
  const targets = parse(posting)
    .querySelectorAll("a[href]")
    .map((link) => link.getAttribute("href")!);
  targets.push(
    ...(posting.match(/https?:\/\/[^\s<>"'\])]+/gi) ?? [])
      .map((target) => target.replace(/[.,;:!?]+$/, "")),
  );
  const urls = new Set<string>();
  for (const target of targets) {
    try {
      const url = new URL(target, baseUrl || undefined);
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username && !url.password
      )
        urls.add(url.href);
    } catch {
      // A relative link needs the original posting URL.
    }
  }
  return [...urls];
}

type RouteFields = Pick<z.infer<typeof analysisSchema>, "recruiterEmail" | "applicationUrl" | "applicationInstructions">;
export function verifyApplicationRoute<T extends RouteFields>(
  extracted: T,
  posting: string,
  baseUrl?: string,
  manualMetadata?: Record<string, unknown>,
) {
  const result = { ...extracted, ...manualMetadata } as T;
  const warnings: string[] = [];
  if (
    result.recruiterEmail && !manualMetadata?.recruiterEmail &&
    !emailAddresses(posting).some(
      (address) => address.toLowerCase() === result.recruiterEmail!.toLowerCase(),
    )
  ) {
    result.recruiterEmail = null;
    warnings.push("The extracted recruiter email was not present in the posting and was discarded.");
  }
  if (result.applicationUrl) {
    const url = applicationLinks(result.applicationUrl)[0];
    if (url && applicationLinks(posting, baseUrl).includes(url)) {
      result.applicationUrl = url;
    } else {
      result.applicationUrl = null;
      warnings.push("The extracted application link was not present in the posting and was discarded.");
    }
  }
  if (
    result.applicationInstructions &&
    !posting.replace(/\s+/g, " ").includes(
      result.applicationInstructions.replace(/\s+/g, " "),
    )
  ) {
    result.applicationInstructions = null;
  }
  if (!result.recruiterEmail && !result.applicationUrl)
    warnings.push("No verified application email or link was found. Check the posting's instructions before submitting.");
  return { ...result, warnings, contactEmails: emailAddresses(posting), channel: result.applicationUrl ? "portal" as const : result.recruiterEmail ? "email" as const : "unresolved" as const };
}
