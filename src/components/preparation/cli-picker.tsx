"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/toast";
import type { CliOptions } from "@/lib/preparation/types";
import { preparationRequest } from "./client";

type Model = {
  id: string;
  display_name: string;
  reasoning_efforts: string[];
  default_reasoning_effort: string;
};
export function CliPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: CliOptions;
  onChange: (value: CliOptions) => void;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<Model[]>([]),
    [loading, setLoading] = useState(false);
  return (
    <fieldset
      disabled={disabled}
      className="grid items-end gap-3 sm:grid-cols-2"
    >
      <legend className="mb-3 text-sm font-medium">
        AI for this preparation
      </legend>
      <Select
        label="Coding CLI"
        value={value.provider}
        onChange={(event) => {
          onChange({
            ...value,
            provider: event.target.value as CliOptions["provider"],
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
        disabled={disabled || loading}
        onClick={async () => {
          setLoading(true);
          try {
            const result = await preparationRequest<{ models: Model[] }>(
              "capabilities",
              { provider: value.provider },
            );
            setModels(result.models);
            toast("CLI connection verified.");
          } catch (error) {
            toast((error as Error).message);
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? "Checking CLI…" : "Load available models"}
      </Button>
      {models.length ? (
        <Select
          label="Model"
          value={value.model}
          onChange={(event) => {
            const model = models.find(
              (entry) => entry.id === event.target.value,
            );
            onChange({
              ...value,
              model: event.target.value,
              effort: (model && !model.reasoning_efforts.includes(value.effort)
                ? model.default_reasoning_effort
                : value.effort) as CliOptions["effort"],
            });
          }}
        >
          <option value="">Select model</option>
          {models.map((model) => (
            <option value={model.id} key={model.id}>
              {model.display_name}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          label="Model"
          value={value.model}
          onChange={(event) =>
            onChange({ ...value, model: event.target.value })
          }
        />
      )}
      <Select
        label="Thinking effort"
        value={value.effort}
        onChange={(event) =>
          onChange({
            ...value,
            effort: event.target.value as CliOptions["effort"],
          })
        }
      >
        {(
          models.find((model) => model.id === value.model)
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
    </fieldset>
  );
}
