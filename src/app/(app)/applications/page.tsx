import { userTimeZone } from "@/lib/time-zone";
import type { Metadata } from "next";

import { listSummary, resolveListParams, statusesIn } from "@/lib/applications-list";
import { loadApplicationRows } from "@/lib/applications-data";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

import { ApplicationsScreen } from "./applications-screen";

export const metadata: Metadata = { title: "Applications" };

/** Every application, on a board or in a table, with search and filters (PRD §6.6). */
export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  // The URL wins; without it, the view, filter and sort last used (LST-7).
  const params = resolveListParams(await searchParams, await loadSettings());

  const [all, searched, archived] = await Promise.all([
    loadApplicationRows({ archived: params.archived, sort: params.sort }),
    loadApplicationRows({ archived: params.archived, sort: params.sort, q: params.q, fields: params.fields }),
    prisma.application.count({ where: { archivedAt: { not: null }, awaitingReview: false } }),
  ]);
  const found = searched;
  const counts = {
    all: all.length,
    active: all.filter((row) => statusesIn("active").includes(row.status)).length,
    closed: all.filter((row) => statusesIn("closed").includes(row.status)).length,
  };
  const current = all.filter((row) => !row.archived);

  return (
    <ApplicationsScreen
      params={params}
      timeZone={new Intl.DateTimeFormat("en", { timeZone: await userTimeZone() }).resolvedOptions().timeZone}
      rows={found.filter((row) => statusesIn(params.filter).includes(row.status))}
      counts={counts}
      summary={listSummary(current.map((row) => row.status))}
      empty={current.length === 0 && all.length === 0 && archived === 0}
      archivedCount={archived}
    />
  );
}
