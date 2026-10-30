import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GENERATION_PROMPTS } from "@/lib/generation-prompts";
import { saveGenerationPrompt } from "./actions";
import { PromptsSection } from "./prompts-section";

vi.mock("./actions", () => ({ saveGenerationPrompt: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const props = { initial: DEFAULT_GENERATION_PROMPTS, initialMode: "NATIVE" as const, nativeRules: "Native rules", latexRules: "LaTeX rules" };
beforeEach(() => vi.mocked(saveGenerationPrompt).mockReset().mockResolvedValue({ ok: true, data: null }));

describe("generation prompts", () => {
  it("shows the saved instructions for each mode and its automatic rules", async () => {
    const user = userEvent.setup();
    render(<PromptsSection {...props} initial={{ ...props.initial, cvPrompt: "My CV instructions" }} />);
    expect(screen.getByLabelText("CV prompt")).toHaveValue("My CV instructions");
    expect(screen.getByLabelText("Motivation letter prompt")).toHaveValue(DEFAULT_GENERATION_PROMPTS.letterPrompt);
    expect(screen.getByLabelText("Email draft prompt")).toHaveValue(DEFAULT_GENERATION_PROMPTS.emailPrompt);
    await user.click(screen.getByRole("radio", { name: "LaTeX preparation" }));
    expect(screen.getByLabelText("CV prompt")).toHaveValue(DEFAULT_GENERATION_PROMPTS.latexCvPrompt);
    await user.click(screen.getByText("Rules added automatically"));
    expect(screen.getByText("LaTeX rules")).toBeVisible();
    expect(saveGenerationPrompt).not.toHaveBeenCalled();
  });

  it("saves edits by their own key and restores the default", async () => {
    const user = userEvent.setup();
    render(<PromptsSection {...props} initialMode="LATEX" />);
    fireEvent.change(screen.getByLabelText("CV prompt"), { target: { value: "Emphasise my coursework." } });
    fireEvent.blur(screen.getByLabelText("CV prompt"));
    await waitFor(() => expect(saveGenerationPrompt).toHaveBeenLastCalledWith({ key: "latexCvPrompt", text: "Emphasise my coursework." }));
    await user.click(screen.getAllByRole("button", { name: "Restore default" })[0]);
    fireEvent.blur(screen.getByLabelText("CV prompt"));
    await waitFor(() => expect(saveGenerationPrompt).toHaveBeenLastCalledWith({ key: "latexCvPrompt", text: DEFAULT_GENERATION_PROMPTS.latexCvPrompt }));
  });

  it("keeps unsaved text visible when saving fails", async () => {
    vi.mocked(saveGenerationPrompt).mockResolvedValue({ ok: false, error: "Could not save." } as never);
    render(<PromptsSection {...props} />);
    fireEvent.change(screen.getByLabelText("Email draft prompt"), { target: { value: "Use a short greeting." } });
    fireEvent.blur(screen.getByLabelText("Email draft prompt"));
    await waitFor(() => expect(screen.getByText("Couldn't save")).toBeVisible());
    expect(screen.getByLabelText("Email draft prompt")).toHaveValue("Use a short greeting.");
  });
});
