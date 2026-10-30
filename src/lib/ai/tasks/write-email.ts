import { z } from "zod";

import { DEFAULT_GENERATION_PROMPTS } from "@/lib/generation-prompts";

import type { Tone } from "@/generated/prisma/enums";
import type { Extracted, Match, Unit } from "@/lib/application-data";
import { emailUnits, isEmailAddress } from "@/lib/application-email";
import type { ProfileData } from "@/lib/profile";
import { TONES } from "@/lib/tones";

import { guardSources, guardUnits } from "../fact-guard";

import {
  applicationFacts,
  candidateFacts,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  postingForPrompt,
  profileForPrompt,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";
import { withoutFrame } from "./write-cover-letter";

export const WRITE_EMAIL_VERSION = "write-email@2";

const answerSchema = z.object({
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  subject: z.string(),
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  signOff: z.string(),
});

export type EmailInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  tone: Tone;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted: where to send the application, and for the fact guard. */
  posting: string;
  /** The cover letter's paragraphs, so the email doesn't repeat them. */
  letter: string[];
};

/**
 * The application's email (its Email tab): the recipient the posting names,
 * a subject and the message, as the units "to", "subject" and "body". The
 * message ends with the sign-off and the candidate's name. An address the
 * posting doesn't contain is never used, so the recipient may be empty.
 */
export const writeEmail: Task<EmailInput, Unit[]> = async (provider, { profile, extracted, match, tone, facts, posting, letter }, options) => {
  const answer = await provider.complete({
    system: system(
      options.prompts?.emailPrompt ?? DEFAULT_GENERATION_PROMPTS.emailPrompt,
      `Tone: ${TONES[tone].label}. ${TONES[tone].description}`,
      truthfulness(options.strict),
      candidateFacts(profile, facts),
      CREATIVITY[options.creativity],
      languageRule(options.language),
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, match)}`,
          letter.length > 0 && `The cover letter it goes with:\n${letter.join("\n\n")}`,
          applicationFacts(facts),
          `The posting, for who to send it to and how:\n${postingForPrompt(posting)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "application_email",
    creativity: options.creativity,
    signal: options.signal,
  });

  // English emails get the tone's own sign-off, as letters do; other languages keep the model's.
  const language = options.language ?? extracted.language ?? "English";
  const signOff = /^english$/i.test(language) || !answer.signOff.trim() ? TONES[tone].signOff : answer.signOff.trim();
  const paragraphs = withoutFrame(answer.paragraphs.map((text) => ({ text })), signOff)
    .map((paragraph) => paragraph.text.trim())
    .filter(Boolean);
  const body = [answer.greeting.trim(), ...paragraphs, [signOff, profile.basics.name.trim()].filter(Boolean).join("\n")]
    .filter(Boolean)
    .join("\n\n");

  const [to, ...written] = emailUnits({ to: recipient(answer.contactName, answer.contactEmail, posting), subject: oneLine(answer.subject), body });
  return {
    // The recipient comes from the posting; the subject and message are checked like the letter's paragraphs.
    data: [to, ...(options.strict ? guardUnits(written, guardSources(profile, extracted, posting, facts)) : written)],
    promptVersion: WRITE_EMAIL_VERSION,
  };
};

/**
 * "John Doe <john@example.com>", or just the address. Empty unless the
 * posting has the address, so a guessed one is never used.
 */
export function recipient(name: string | null, address: string | null, posting: string): string {
  const email = address?.trim().replace(/^mailto:/i, "") ?? "";
  if (!isEmailAddress(email) || !posting.toLowerCase().includes(email.toLowerCase())) return "";
  const who = oneLine(name ?? "").replace(/[<>"]/g, "");
  return who && who.toLowerCase() !== email.toLowerCase() ? `${who} <${email}>` : email;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
