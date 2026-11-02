import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EmailDraftingSection } from "./email-drafting-section";
import { updateSettings } from "./actions";
vi.mock("./actions", () => ({ updateSettings: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toastResult: (result: unknown) => result }));

it("exposes and saves the global automatic-email policy", async () => {
  render(<EmailDraftingSection initial="AUTO" />);
  expect(screen.getByLabelText("Automatic email drafting")).toHaveValue("AUTO");
  await userEvent.setup().selectOptions(screen.getByLabelText("Automatic email drafting"), "DISABLE");
  expect(updateSettings).toHaveBeenCalledWith({ emailDraftMode: "DISABLE" });
});
