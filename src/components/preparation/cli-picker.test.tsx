import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { CliPicker } from "./cli-picker";
import { preparationRequest } from "./client";
import { EMPTY_PROJECT, type CliOptions } from "@/lib/preparation/types";

vi.mock("./client", () => ({ preparationRequest: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
const model = { id: "test", display_name: "Test model", reasoning_efforts: ["high", "max"], default_reasoning_effort: "high" };
function Picker() {
  const [value, setValue] = useState<CliOptions>({ ...EMPTY_PROJECT, model: "test", effort: "max" });
  return <CliPicker value={value} onChange={setValue} />;
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
it("persists catalogs and effort metadata across mounts, isolates providers and keeps selections", async () => {
  const user = userEvent.setup();
  vi.mocked(preparationRequest).mockResolvedValue({ models: [model] });
  const first = render(<Picker />);
  await user.click(screen.getByRole("button", { name: "Load available models" }));
  expect(screen.getByLabelText("Thinking effort")).toHaveValue("max");
  first.unmount();
  render(<Picker />);
  expect(screen.getByRole("option", { name: "Test model" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "low" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Coding CLI"), "claude");
  expect(screen.getByLabelText("Model")).toHaveValue("");
  await user.selectOptions(screen.getByLabelText("Coding CLI"), "codex");
  expect(screen.getByLabelText("Model")).toHaveValue("test");
  expect(screen.getByLabelText("Thinking effort")).toHaveValue("max");
  expect(preparationRequest).toHaveBeenCalledTimes(1);
});
it("retains the saved catalog and selection when refreshing fails", async () => {
  localStorage.setItem("cli-models:codex", JSON.stringify([model]));
  vi.mocked(preparationRequest).mockRejectedValue(new Error("Worker offline"));
  render(<Picker />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh available models" }));
  expect(screen.getByLabelText("Model")).toHaveValue("test");
  expect(screen.getByLabelText("Thinking effort")).toHaveValue("max");
  expect(JSON.parse(localStorage.getItem("cli-models:codex")!)).toEqual([model]);
});
