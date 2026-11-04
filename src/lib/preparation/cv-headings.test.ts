import { describe, expect, it } from "vitest";
import { changedCvHeading } from "./cv-headings";

describe("CV section headings", () => {
  const source = "\\section*{Education}\n\\section*{Technical Projects}\n\\section*{Skills}";

  it("allows removing sections and retaining their original headings", () => {
    expect(changedCvHeading(source, "\\section*{Technical Projects}\n\\section*{Skills}")).toBeUndefined();
  });

  it("rejects renamed and new headings", () => {
    expect(changedCvHeading(source, "\\section*{SELECTED TECHNICAL PROJECT}")).toBe("SELECTED TECHNICAL PROJECT");
    expect(changedCvHeading(source, "\\section*{Skills}\n\\section*{Highlights}")).toBe("Highlights");
  });
});
