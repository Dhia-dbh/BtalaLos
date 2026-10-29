"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/toast";
import { type BundleItem, type Project } from "@/lib/preparation/types";
import { preparationRequest } from "./client";

type LibraryData = {
  project: Project;
  profiles: { id: string; name: string; version: number; items: unknown }[];
  documents: {
    id: string;
    name: string;
    versions: { id: string; version: number; pages: number }[];
  }[];
};
export function PreparationLibrary({ initial }: { initial: LibraryData }) {
  const [data, setData] = useState(initial);
  const [project, setProject] = useState(initial.project);
  const [files, setFiles] = useState(initial.project.editablePaths.join("\n"));
  const [busy, setBusy] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [items, setItems] = useState<BundleItem[]>([
    { role: "cv" },
    { role: "letter" },
  ]);
  const [models, setModels] = useState<
    { id: string; display_name: string; reasoning_efforts: string[] }[]
  >([]);
  const refresh = async () => {
    const response = await fetch("/api/preparation/library");
    if (!response.ok) throw new Error("Could not refresh the library.");
    setData(await response.json());
  };
  const work = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      await refresh();
      toast("Saved.");
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selected = data.profiles.find((profile) => profile.id === profileId);
  return (
    <div className="flex max-w-5xl flex-col gap-7 px-6 pb-16 sm:px-10">
      <p className="max-w-prose text-sm text-muted">
        Build application packages from your native documents or your LaTeX
        project.{" "}
        <Link href="/new/latex" className="underline">
          Create a LaTeX application
        </Link>
        .
      </p>
      <Card className="flex flex-col gap-4">
        <h2 className="font-serif text-section">Supporting documents</h2>
        <p className="text-sm text-muted">
          Upload PDFs once. Replacements create a new version; earlier packages
          keep their original files.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void work(async () => {
              const response = await fetch("/api/preparation/upload", {
                method: "POST",
                body: form,
              });
              if (!response.ok) throw new Error((await response.json()).error);
            });
          }}
        >
          <Input label="Document name" name="name" required maxLength={200} />
          <Input
            label="PDF file"
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            required
          />
          <Button type="submit" disabled={busy}>
            Upload PDF
          </Button>
        </form>
        <ul className="divide-y divide-line">
          {data.documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <a
                href={`/api/artifacts/${document.versions[0].id}`}
                className="min-w-0 flex-1 break-words underline"
              >
                {document.name}
              </a>
              <span className="text-meta text-muted">
                Version {document.versions[0].version} ·{" "}
                {document.versions[0].pages} pages
              </span>
              <label className="cursor-pointer text-sm underline">
                Replace PDF
                <input
                  aria-label={`Replace ${document.name}`}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.set("name", document.name);
                    form.set("documentId", document.id);
                    form.set("version", String(document.versions[0].version));
                    form.set("file", file);
                    void work(async () => {
                      const response = await fetch("/api/preparation/upload", {
                        method: "POST",
                        body: form,
                      });
                      if (!response.ok)
                        throw new Error((await response.json()).error);
                    });
                    event.target.value = "";
                  }}
                />
              </label>
              <Button
                size="sm"
                variant="text"
                disabled={busy}
                onClick={() =>
                  void work(() =>
                    preparationRequest("delete-document", { id: document.id }),
                  )
                }
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-4">
        <h2 className="font-serif text-section">Application profiles</h2>
        <Select
          label="Edit a profile"
          value={profileId}
          onChange={(event) => {
            const id = event.target.value;
            setProfileId(id);
            const profile = data.profiles.find((entry) => entry.id === id);
            setName(profile?.name ?? "");
            setItems(
              profile
                ? (profile.items as BundleItem[])
                : [{ role: "cv" }, { role: "letter" }],
            );
          }}
        >
          <option value="">New profile</option>
          {data.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </Select>
        <Input
          label="Profile name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="For example, PhD"
        />
        <ol className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-meta text-muted">{index + 1}.</span>
              <Select
                aria-label={`Document ${index + 1}`}
                className="min-w-40 flex-1"
                value={item.role === "supporting" ? item.documentId : item.role}
                onChange={(event) =>
                  setItems(
                    items.map((entry, position) =>
                      position !== index
                        ? entry
                        : ["cv", "letter"].includes(event.target.value)
                          ? { role: event.target.value as "cv" | "letter" }
                          : {
                              role: "supporting",
                              documentId: event.target.value,
                            },
                    ),
                  )
                }
              >
                <option value="cv">CV</option>
                <option value="letter">Cover letter</option>
                {data.documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Move document ${index + 1} up`}
                disabled={index === 0}
                onClick={() => {
                  const next = [...items];
                  [next[index - 1], next[index]] = [
                    next[index],
                    next[index - 1],
                  ];
                  setItems(next);
                }}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Move document ${index + 1} down`}
                disabled={index === items.length - 1}
                onClick={() => {
                  const next = [...items];
                  [next[index + 1], next[index]] = [
                    next[index],
                    next[index + 1],
                  ];
                  setItems(next);
                }}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="text"
                onClick={() =>
                  setItems(items.filter((_, position) => position !== index))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() => setItems([...items, { role: "cv" }])}
          >
            Add document
          </Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              void work(() =>
                preparationRequest("profile", {
                  ...(profileId
                    ? { id: profileId, version: selected?.version }
                    : {}),
                  name,
                  items,
                }),
              )
            }
          >
            Save profile
          </Button>
          {profileId && (
            <Button
              variant="text"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await preparationRequest("delete-profile", { id: profileId });
                  setProfileId("");
                  setName("");
                  setItems([{ role: "cv" }, { role: "letter" }]);
                })
              }
            >
              Delete profile
            </Button>
          )}
        </div>
      </Card>
      <Card className="flex flex-col gap-5">
        <h2 className="font-serif text-section">LaTeX project</h2>
        <p className="text-sm text-muted">
          Use a committed base revision. Each application gets a separate branch
          and worktree. The host worker must allow this repository.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["repository", "Git repository"],
              ["baseRef", "Base reference"],
              ["cvPath", "CV entrypoint (.tex)"],
              ["letterPath", "Cover-letter entrypoint (.tex)"],
              ["fileName", "Merged PDF filename"],
            ] as const
          ).map(([key, label]) => (
            <Input
              key={key}
              label={label}
              value={project[key]}
              onChange={(event) =>
                setProject({ ...project, [key]: event.target.value })
              }
            />
          ))}
          <Select
            label="LaTeX engine"
            value={project.engine}
            onChange={(event) =>
              setProject({
                ...project,
                engine: event.target.value as Project["engine"],
              })
            }
          >
            {["pdflatex", "xelatex", "lualatex"].map((engine) => (
              <option key={engine}>{engine}</option>
            ))}
          </Select>
        </div>
        <Textarea
          label="Editable source files"
          hint="One repository-relative .tex path per line. Include both entrypoints."
          rows={4}
          value={files}
          onChange={(event) => setFiles(event.target.value)}
        />
        <div className="grid items-end gap-4 sm:grid-cols-2">
          <Select
            label="Coding CLI"
            value={project.provider}
            onChange={(event) => {
              setProject({
                ...project,
                provider: event.target.value as Project["provider"],
                model: "",
              });
              setModels([]);
            }}
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </Select>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void work(async () => {
                const result = await preparationRequest<{
                  models: typeof models;
                }>("capabilities", { provider: project.provider });
                setModels(result.models);
              })
            }
          >
            Test CLI and load models
          </Button>
          {models.length ? (
            <Select
              label="Model"
              value={project.model}
              onChange={(event) =>
                setProject({ ...project, model: event.target.value })
              }
            >
              <option value="">Select model</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.display_name}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              label="Model"
              value={project.model}
              onChange={(event) =>
                setProject({ ...project, model: event.target.value })
              }
            />
          )}
          <Select
            label="Thinking effort"
            value={project.effort}
            onChange={(event) =>
              setProject({
                ...project,
                effort: event.target.value as Project["effort"],
              })
            }
          >
            {(
              models.find((model) => model.id === project.model)
                ?.reasoning_efforts ?? [
                "minimal",
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ]
            ).map((effort) => (
              <option key={effort}>{effort}</option>
            ))}
          </Select>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">
            Applicant context
          </legend>
          <p className="mb-2 text-sm text-muted">
            Only selected documents are used as additional applicant evidence.
          </p>
          {data.documents.map((document) => (
            <label className="flex gap-2 text-sm" key={document.id}>
              <input
                type="checkbox"
                checked={project.contextDocumentIds.includes(document.id)}
                onChange={(event) =>
                  setProject({
                    ...project,
                    contextDocumentIds: event.target.checked
                      ? [...project.contextDocumentIds, document.id]
                      : project.contextDocumentIds.filter(
                          (id) => id !== document.id,
                        ),
                  })
                }
              />
              {document.name}
            </label>
          ))}
        </fieldset>
        <Button
          className="self-start"
          disabled={busy}
          onClick={() =>
            void work(() =>
              preparationRequest("config", {
                ...project,
                editablePaths: files
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }),
            )
          }
        >
          Validate and save project
        </Button>
      </Card>
    </div>
  );
}
