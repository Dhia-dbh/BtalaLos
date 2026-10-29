#!/usr/bin/env node
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args[0] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }));
  process.exit(0);
}
if (args[0] === "--help") {
  console.log(
    "--tools --strict-mcp-config --setting-sources --json-schema --effort --model",
  );
  process.exit(0);
}
if (args[0] === "app-server") {
  createInterface({ input: process.stdin }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === 1) console.log(JSON.stringify({ id: 1, result: {} }));
    if (message.id === 2)
      console.log(
        JSON.stringify({
          id: 2,
          result: {
            data: [
              {
                model: "fixture",
                displayName: "Fixture",
                supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
                defaultReasoningEffort: "medium",
              },
            ],
            nextCursor: null,
          },
        }),
      );
  });
} else {
  let input = "";
  for await (const part of process.stdin) input += part;
  const isCodex = args[0] === "exec";
  if (!isCodex) JSON.parse(args[args.indexOf("--json-schema") + 1]);
  const prompt = isCodex
    ? JSON.parse(
        input
          .slice(
            input.indexOf("serialized below as JSON:") +
              "serialized below as JSON:".length,
          )
          .trim(),
      ).at(-1).content
    : input;
  let answer;
  if (prompt.includes("SOURCE FILES:\n")) {
    const files = JSON.parse(
      prompt.slice(
        prompt.lastIndexOf("SOURCE FILES:\n") + "SOURCE FILES:\n".length,
      ),
    );
    const overflows =
      prompt.includes("FORCE_OVERFLOW") &&
      (!prompt.includes("Shorten only overflowing") ||
        prompt.includes("NEVER_FIT"));
    answer = {
      files: Object.entries(files).map(([path, content]) => ({
        path,
        content: content.replace(
          /\\end\{document\}/,
          `${overflows && path === "cv.tex" ? "\\newpage Overflow" : ""}\\end{document}`,
        ),
      })),
    };
    if (
      prompt.includes("Shorten only overflowing") &&
      !prompt.includes("NEVER_FIT")
    )
      answer.files = answer.files.map((file) => ({
        ...file,
        content: file.content.replaceAll("\\newpage Overflow", ""),
      }));
  } else if (prompt.includes("Extract only explicit job facts")) {
    answer = {
      title: "Researcher at Example",
      company: "Example",
      role: "Researcher",
      location: "Berlin",
      mode: null,
      salary: null,
      deadline: "2026-12-31",
      externalJobId: "42",
      recruiterName: null,
      recruiterEmail: "hr@example.org",
      applicationMethod: "email",
      applicationUrl: null,
      keywords: ["Python"],
      requirements: ["Python"],
    };
  } else
    answer = {
      subject: "Application for Researcher",
      body: "Please find my application package attached.",
    };
  if (isCodex) {
    console.log(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: JSON.stringify(answer) },
      }),
    );
    console.log(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  } else
    console.log(JSON.stringify({ structured_output: answer, is_error: false }));
}
