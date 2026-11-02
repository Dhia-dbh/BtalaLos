import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EmailDraftingSelect } from "./email-drafting-select";

it("distinguishes inheriting the global setting from an explicit override", async () => {
  const onChange = vi.fn();
  render(<EmailDraftingSelect value={null} globalMode="DISABLE" onChange={onChange} />);
  const select = screen.getByLabelText("Automatic email drafting");
  expect(select).toHaveValue("GLOBAL");
  expect(screen.getByRole("option", { name: "Use global setting (disable)" })).toBeInTheDocument();
  await userEvent.setup().selectOptions(select, "ENABLE");
  expect(onChange).toHaveBeenLastCalledWith("ENABLE");
  await userEvent.setup().selectOptions(select, "GLOBAL");
  expect(onChange).toHaveBeenLastCalledWith(null);
});
