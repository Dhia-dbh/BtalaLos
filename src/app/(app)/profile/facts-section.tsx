"use client";

import { FactList } from "@/components/fact-list";
import type { ProfileData } from "@/lib/profile";

import type { UpdateProfile } from "./skills-section";

/**
 * Facts about me (PRO-14): things only the user can say, such as why they're
 * changing careers or when they can start. Given to the AI with the profile.
 */
export function FactsSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  return (
    <FactList
      applicationId={null}
      facts={profile.facts}
      setFacts={(change) => update((current) => ({ ...current, facts: change(current.facts) }))}
      placeholder="e.g. My university course covered graph algorithms and complexity. For a personal project, I built a Python tool to analyse battery measurements. Include dates, links or certification details where useful."
    />
  );
}
