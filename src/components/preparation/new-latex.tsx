"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/toast";
import { CliPicker } from "./cli-picker";
import { EMPTY_PROJECT, type CliOptions } from "@/lib/preparation/types";
import { preparationRequest } from "./client";
export function NewLatex({
  profiles,
  initialPosting = "",
  initialUrl = "",
  initialCli = EMPTY_PROJECT,
  configured,
}: {
  profiles: { id: string; name: string }[];
  initialPosting?: string;
  initialUrl?: string;
  initialCli?: CliOptions;
  configured: boolean;
}) {
  const router = useRouter();
  const [cli, setCli] = useState<CliOptions>(initialCli);
  const [posting, setPosting] = useState(initialPosting),
    [postingUrl, setPostingUrl] = useState(initialUrl),
    [profileId, setProfileId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex max-w-4xl flex-col gap-5 px-6 pb-16 sm:px-10"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const result = await preparationRequest<{ id: string }>("create", {
            posting,
            postingUrl,
            profileId,
            instructions,
            ...(cli.model ? { cli } : {}),
          });
          router.push(`/applications/${result.id}`);
        } catch (error) {
          toast((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Select
        label="Document mode"
        value="LATEX"
        onChange={() => {
          const query = new URLSearchParams(window.location.search);
          query.set("mode", "NATIVE");
          router.push(`/new?${query}`);
        }}
      >
        <option value="NATIVE">Dossier documents</option>
        <option value="LATEX">LaTeX project</option>
      </Select>
      <Card className="flex flex-col gap-4">
        {!configured && (
          <p role="status" className="text-sm text-muted">
            Configure and save your existing LaTeX project in Settings before
            preparing an application.
          </p>
        )}
        <Textarea
          label="Job posting"
          rows={13}
          value={posting}
          onChange={(event) => setPosting(event.target.value)}
          required
          maxLength={100_000}
        />
        <Input
          label="Posting URL (optional)"
          value={postingUrl}
          onChange={(event) => setPostingUrl(event.target.value)}
        />
        <Select
          label="Application profile"
          value={profileId}
          onChange={(event) => setProfileId(event.target.value)}
          required
        >
          <option value="">Select a profile</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </Select>
        <CliPicker value={cli} onChange={setCli} disabled={busy} />
        <Textarea
          label="Tailoring instructions (optional)"
          rows={3}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          maxLength={4000}
        />
        <p className="text-sm text-muted">
          Preparation runs automatically through analysis, one-page CV and cover
          letter, merged PDF, and an editable email draft.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="submit"
            disabled={busy || !profiles.length || !configured}
          >
            {busy ? "Starting preparation…" : "Prepare application"}
          </Button>
          <Link href="/settings?section=latex" className="text-sm underline">
            Configure LaTeX project
          </Link>
          <Link href="/settings?section=profiles" className="text-sm underline">
            Manage job profiles and PDF bundles
          </Link>
        </div>
      </Card>
    </form>
  );
}
