"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/toast";
import type { DocumentMode, Project } from "@/lib/preparation/types";
import type { LibraryData } from "./library";
import { preparationRequest } from "./client";
import { RepositoryPicker, type RepositoryFiles } from "./repository-picker";

export function ProjectSettings({
  initial,
  initialMode,
}: {
  initial: LibraryData;
  initialMode: DocumentMode;
}) {
  const router = useRouter();
  const [project, setProject] = useState(initial.project);
  const [texFiles, setTexFiles] = useState<string[]>([]);
  const [repositoryError, setRepositoryError] = useState("");
  useEffect(() => {
    if (!initial.project.repository) return;
    let current = true;
    void preparationRequest<RepositoryFiles>("repository", {
      repository: initial.project.repository,
    })
      .then((result) => {
        if (current) setTexFiles(result.files);
      })
      .catch((error) => {
        if (current) setRepositoryError(error.message);
      });
    return () => {
      current = false;
    };
  }, [initial.project.repository]);
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<
    { id: string; display_name: string; reasoning_efforts: string[] }[]
  >([]);
  const work = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
      toast("Saved.");
      router.refresh();
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card className="flex flex-col gap-4">
        <h2 className="font-serif text-section">Application documents</h2>
        <Select
          label="Default document mode"
          value={mode}
          disabled={busy}
          onChange={(event) => {
            const documentMode = event.target.value as DocumentMode;
            void work(async () => {
              await preparationRequest("document-mode", { documentMode });
              setMode(documentMode);
            });
          }}
        >
          <option value="NATIVE">Dossier documents</option>
          <option value="LATEX">Existing LaTeX project</option>
        </Select>
        <p className="text-sm text-muted">
          New applications use this mode. LaTeX applications use your existing
          sources, create a branch for each application, and compile the
          tailored CV and cover letter with latexmk.
        </p>
        <Link href="/settings?section=profiles" className="text-sm underline">
          Manage job profiles and PDF bundles
        </Link>
      </Card>
      <Card className="flex flex-col gap-5">
        <h2 className="font-serif text-section">LaTeX project</h2>
        <p className="text-sm text-muted">
          Choose an existing Git repository on the worker computer. Each
          application gets a separate branch and worktree. Commit the selected
          sources before preparing an application.
        </p>
        <Input label="Git repository" value={project.repository} readOnly />
        <RepositoryPicker
          repository={project.repository}
          disabled={busy}
          onSelect={(result) => {
            setTexFiles(result.files);
            setRepositoryError("");
            setProject((current) =>
              current.repository === result.repository
                ? {
                    ...current,
                    cvPath: result.files.includes(current.cvPath)
                      ? current.cvPath
                      : "",
                    letterPath: result.files.includes(current.letterPath)
                      ? current.letterPath
                      : "",
                    editablePaths: current.editablePaths.filter((file) =>
                      result.files.includes(file),
                    ),
                  }
                : {
                    ...current,
                    repository: result.repository,
                    cvPath: "",
                    letterPath: "",
                    editablePaths: [],
                  },
            );
          }}
        />
        {repositoryError && (
          <p role="alert" className="text-sm text-danger">
            {repositoryError}
          </p>
        )}
        {project.repository && !texFiles.length && !repositoryError && (
          <p className="text-sm text-muted">
            No .tex files loaded. Browse to the repository to load its source
            files.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["baseRef", "Base reference"],
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
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["cvPath", "CV entrypoint (.tex)"],
              ["letterPath", "Cover-letter entrypoint (.tex)"],
            ] as const
          ).map(([key, label]) => (
            <Select
              key={key}
              label={label}
              value={project[key]}
              disabled={busy || !texFiles.length}
              onChange={(event) => {
                const value = event.target.value;
                setProject({
                  ...project,
                  [key]: value,
                  editablePaths: value
                    ? [...new Set([...project.editablePaths, value])]
                    : project.editablePaths,
                });
              }}
            >
              <option value="">Select a .tex file</option>
              {texFiles.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </Select>
          ))}
        </div>
        <Select
          label="Editable source files"
          multiple
          size={Math.min(8, Math.max(3, texFiles.length))}
          value={project.editablePaths}
          disabled={busy || !texFiles.length}
          hint="Select the files AI may edit. Include both entrypoints. Hold Ctrl or Cmd to select multiple files."
          onChange={(event) =>
            setProject({
              ...project,
              editablePaths: Array.from(
                event.target.selectedOptions,
                (option) => option.value,
              ),
            })
          }
        >
          {texFiles.map((file) => (
            <option key={file} value={file}>
              {file}
            </option>
          ))}
        </Select>
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
          {initial.documents.map((document) => (
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
              }),
            )
          }
        >
          Validate and save project
        </Button>
      </Card>
    </>
  );
}
