"use client";
import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { toast } from "@/components/toast";
import { preparationRequest } from "./client";
export function PackageFolderButton({
  applicationId,
}: {
  applicationId: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-label="Open application folder"
      title="Open application folder on this server"
      disabled={busy}
      className="relative z-10 rounded-control p-1.5 text-muted hover:text-ink disabled:opacity-50"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        setBusy(true);
        try {
          await preparationRequest("reveal", { applicationId });
        } catch (error) {
          toast((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <FolderOpen size={16} aria-hidden />
    </button>
  );
}
