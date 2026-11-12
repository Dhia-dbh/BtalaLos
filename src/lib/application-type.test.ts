import { expect, it } from "vitest";
import { answerRewritePrompt, answerRewriteSchema, formAnswersSchema } from "./application-type";
it("requires an instruction for custom edits and constrains grammar edits", () => {
  expect(answerRewriteSchema.safeParse({ question: "Why?", answer: "I has experience", operation: "custom", instruction: "" }).success).toBe(false);
  expect(answerRewritePrompt(answerRewriteSchema.parse({ question: "Why?", answer: "I has experience", operation: "grammar" }))).toContain("Correct grammar, spelling and punctuation only");
  expect(formAnswersSchema.safeParse([{ id: "a", question: "A", answer: "B" }, { id: "a", question: "C", answer: "D" }]).success).toBe(false);
});
