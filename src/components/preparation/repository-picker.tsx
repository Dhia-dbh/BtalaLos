"use client";
import { useState } from "react";
import { Dialog } from "radix-ui";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { preparationRequest } from "./client";

export type RepositoryFiles = { repository: string; files: string[] };
type Folders = {
  directory: string;
  parent: string;
  isRepository: boolean;
  folders: { name: string; path: string }[];
};

export function RepositoryPicker({
  repository,
  disabled,
  onSelect,
}: {
  repository: string;
  disabled: boolean;
  onSelect: (result: RepositoryFiles) => void;
}) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<Folders | null>(null);
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const browse = async (target?: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await preparationRequest<Folders>(
        "directories",
        target ? { directory: target } : {},
      );
      setFolders(result);
      setDirectory(result.directory);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => void browse(repository || undefined)}
        >
          <FolderOpen size={16} /> Browse repositories
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <Dialog.Title className="font-serif text-section">
            Choose a Git repository
          </Dialog.Title>
          <Dialog.Description className="text-sm text-muted">
            Browse folders on the computer running the preparation worker.
            Select the root of your existing Git repository. Files are read in
            place and are not uploaded.
          </Dialog.Description>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void browse(directory);
            }}
          >
            <Input
              label="Folder path"
              className="min-w-0 flex-1"
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              disabled={busy}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={busy || !directory}
            >
              Open folder
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm text-muted">
              Loading folders…
            </p>
          )}
          {folders && (
            <>
              <p className="break-all text-sm text-muted">
                {folders.directory}
              </p>
              <Button
                variant="text"
                className="self-start"
                disabled={busy || folders.parent === folders.directory}
                onClick={() => void browse(folders.parent)}
              >
                Parent folder
              </Button>
              <ul className="max-h-64 overflow-auto rounded-control border border-line">
              {!folders.folders.length && <li className="px-3 py-2 text-sm text-muted">No subfolders</li>}
                {folders.folders.map((folder) => (
                  <li key={folder.path}>
                    <button
                      type="button"
                      disabled={busy}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                      onClick={() => void browse(folder.path)}
                    >
                      <FolderOpen size={16} className="shrink-0" />
                      <span className="break-all">{folder.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!folders.isRepository && (
                <p className="text-sm text-muted">
                  This folder is not a Git repository root.
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Dialog.Close>
            <Button
              disabled={
                busy ||
                !!error ||
                !folders?.isRepository ||
                directory !== folders.directory
              }
              onClick={async () => {
                if (!folders) return;
                setBusy(true);
                setError("");
                try {
                  const result = await preparationRequest<RepositoryFiles>(
                    "repository",
                    { repository: folders.directory },
                  );
                  onSelect(result);
                  setOpen(false);
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Use this repository
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
