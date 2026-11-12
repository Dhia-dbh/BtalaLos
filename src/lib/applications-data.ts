import { matchesApplication, type FieldFilter } from "./application-search";
import { userTimeZone } from "./time-zone";
import "server-only";

import type { ApplicationStatus } from "@/generated/prisma/enums";
import { matchSchema, matchScore } from "@/lib/application-data";
import { sortRows, updatedAgo, type Sort } from "@/lib/applications-list";
import { formatCalendarDate, formatShortDate } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

/** An application as the board and the table show it (E9-2, E9-3). */
export type ApplicationRow = {
  id: string;
  company: string;
  /** The role, or the title when there's no role. */
  role: string;
  location: string;
  mode: string;
  status: ApplicationStatus;
  archived: boolean;
  preparation?: string | null;
  packageId?: string | null;
  /** "Apply by" on draft cards, e.g. "3 Oct 2026". */
  deadline: string | null;
  match: { hit: number; total: number } | null;
  /** When it was sent, e.g. "18 Aug"; null while never sent. */
  sent: string | null;
  /** "Today", "3 days ago"… */
  updated: string;
  /** For the board, which shows the latest update first. */
  updatedAt: number;
  createdDay: string;
};

/** Every application, archived ones only when asked for, sorted for the table; agent drafts once approved (#195). */
export async function loadApplicationRows({ archived, sort, q = "", fields = [] }: { archived: boolean; sort: Sort; q?: string; fields?: FieldFilter[] }, now = new Date()) {
  const applications = await prisma.application.findMany({
    where: { awaitingReview: false, ...(archived ? {} : { archivedAt: null }) },
    select: {
      id: true,
      title: true,
      postingUrl: true, postingText: true, extracted: true, salary: true, language: true, createdAt: true,
      company: true,
      role: true,
      location: true,
      mode: true,
      status: true,
      archivedAt: true,
      deadline: true,
      match: true,
      sentAt: true,
      updatedAt: true,
      preparations: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      artifacts: { where: { role: "package" }, orderBy: { version: "desc" }, take: 1, select: { id: true } },
    },
  });
  const timeZone = await userTimeZone();
  const day = (date: Date | null, calendar = false) => {
    if (!date) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: calendar ? "UTC" : timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)?.value).join("-");
  };
  const rows = applications.filter((app) => matchesApplication({ ...app.extracted as object, ...app, extracted: app.extracted, sentAt: day(app.sentAt), deadline: day(app.deadline, true), createdAt: day(app.createdAt), updatedAt: day(app.updatedAt) }, q, fields)).map((application) => {
    const match = matchSchema.safeParse(application.match);
    return {
      id: application.id,
      createdDay: day(application.createdAt),
      company: application.company.trim(),
      role: application.role.trim() || application.title.trim() || "Untitled application",
      location: application.location.trim(),
      mode: application.mode.trim(),
      status: application.status,
      preparation: application.preparations[0]?.status ?? null,
      packageId: application.artifacts[0]?.id ?? null,
      archived: application.archivedAt !== null,
      match: match.success && match.data.items.length > 0 ? matchScore(match.data) : null,
      sentAt: application.sentAt,
      deadlineAt: application.deadline,
      updatedAt: application.updatedAt,
    };
  });
  return sortRows(rows, sort).map(({ sentAt, deadlineAt, updatedAt, ...row }): ApplicationRow => ({
    ...row,
    deadline: deadlineAt ? formatCalendarDate(deadlineAt) : null,
    sent: sentAt ? formatShortDate(sentAt, now) : null,
    updated: updatedAgo(updatedAt, now),
    updatedAt: updatedAt.getTime(),
  }));
}
