import {
  readFile,
  writeFile,
  lstat,
  realpath,
  readdir,
  rm,
  mkdtemp,
} from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { capabilities, generate, revealExport } from "./host-actions.mjs";
import { hostOperation } from "./host-client.mjs";
import {
  atomic,
  cliEnvironment,
  command,
  digest,
  id,
  inside,
  MAX_FILE,
  MAX_PACKAGE,
  pdf,
  privateDirectory,
  requireValue,
} from "./tools.mjs";


async function workspace(config, applicationId) {
  const root = await inside(
    await privateDirectory(path.join(config.data, "worktrees")),
    id(applicationId),
  );
  requireValue(
    (await command("git", ["-C", root, "branch", "--show-current"], {
      timeout: 20_000,
    })) === `dossier-${applicationId}`,
    "Worktree branch changed. Review it before preparing again.",
  );
  return root;
}
async function filesAt(root, files) {
  const contents = {};
  for (const relative of files) {
    requireValue(
      relative.endsWith(".tex"),
      "Editable files must be .tex files.",
    );
    const file = await inside(root, relative);
    requireValue(
      (await lstat(file)).isFile() && (await lstat(file)).size <= 1024 * 1024,
      "Source must be a regular file under 1 MiB.",
    );
    contents[relative] = await readFile(file, "utf8");
  }
  return contents;
}
async function sharedDirectory(config, requested) {
  const directory = await realpath(requested);
  if (config.repositoryRoot)
    requireValue(
      directory === config.repositoryRoot || directory.startsWith(`${config.repositoryRoot}${path.sep}`),
      "Choose a directory inside the shared repository root.",
    );
  return directory;
}
async function repositoryRoot(config, repository, signal) {
  requireValue(
    typeof repository === "string" && path.isAbsolute(repository),
    "Choose an absolute Git repository path on the worker computer.",
  );
  const root = await sharedDirectory(config, repository);
  const top = await command(
    "git",
    ["-C", root, "rev-parse", "--show-toplevel"],
    { signal },
  );
  requireValue(
    root === top,
    "Choose the Git repository root, not a subfolder.",
  );
  return root;
}
async function checkOrigin(root, repository, signal) {
  const common = async (directory) =>
    realpath(
      await command(
        "git",
        [
          "-C",
          directory,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ],
        { signal },
      ),
    );
  requireValue(
    (await common(root)) === (await common(repository)),
    "This application's worktree belongs to another repository. Create a new application for the selected project.",
  );
}
function checkProject(input) {
  requireValue(
    Array.isArray(input.editablePaths) &&
      input.editablePaths.length > 0 &&
      input.editablePaths.length <= 30,
    "Select authorized source files.",
  );
  requireValue(
    input.editablePaths.includes(input.cvPath) &&
      input.editablePaths.includes(input.letterPath) &&
      input.cvPath !== input.letterPath,
    "Authorize distinct CV and letter entrypoints.",
  );
}
export async function execute(config, input, signal, operationId) {
  const root = await privateDirectory(path.join(config.data, "operations"));
  const temporary = await mkdtemp(path.join(root, `${id(operationId)}-`));
  try {
    return await executeOperation(config, input, signal, operationId, temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function executeOperation(config, input, signal, operationId, temporary) {
  if (["capabilities", "generate"].includes(input.kind)) {
    if (config.hostUrl) return hostOperation(config, input, signal, operationId);
    return input.kind === "capabilities"
      ? capabilities(config, input.provider, signal)
      : generate(config, input, signal);
  }
  if (input.kind === "directories") {
    const requested = input.directory ?? config.repository ?? config.repositoryRoot ?? homedir();
    requireValue(
      typeof requested === "string" && path.isAbsolute(requested),
      "Choose an absolute folder path.",
    );
    const directory = await sharedDirectory(config, requested);
    const entries = await readdir(directory, { withFileTypes: true });
    const marker = await lstat(path.join(directory, ".git")).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    return {
      directory,
      parent: directory === config.repositoryRoot ? directory : path.dirname(directory),
      isRepository: Boolean(marker && !marker.isSymbolicLink()),
      folders: entries
        .filter((entry) => entry.isDirectory() && entry.name !== ".git")
        .map((entry) => ({
          name: entry.name,
          path: path.join(directory, entry.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  if (input.kind === "repository") {
    const repository = await repositoryRoot(config, input.repository, signal);
    const files = [];
    let entries = 0;
    async function scan(relative) {
      signal?.throwIfAborted();
      for (const entry of await readdir(path.join(repository, relative), {
        withFileTypes: true,
      })) {
        requireValue(
          ++entries <= 20000,
          "Repository is too large to list its source files.",
        );
        if (entry.name === ".git" || entry.isSymbolicLink()) continue;
        const file = path.join(relative, entry.name);
        if (entry.isDirectory()) await scan(file);
        else if (entry.isFile() && file.endsWith(".tex")) files.push(file);
      }
    }
    await scan("");
    return { repository, files: files.sort() };
  }
  if (input.kind === "inspect") {
    checkProject(input);
    const repository = await repositoryRoot(config, input.repository, signal);
    requireValue(
      typeof input.baseRef === "string" && !input.baseRef.startsWith("-"),
      "Invalid base reference.",
    );
    const commit = await command(
      "git",
      [
        "-C",
        repository,
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${input.baseRef}^{commit}`,
      ],
      { signal },
    );
    const files = {};
    for (const relative of input.editablePaths) {
      await inside(repository, relative);
      requireValue(
        relative.endsWith(".tex"),
        "Editable sources must be .tex files.",
      );
      const mode = await command(
        "git",
        ["-C", repository, "ls-tree", commit, "--", relative],
        { signal },
      );
      requireValue(
        /^100(644|755) blob /.test(mode),
        "Select regular tracked source files.",
      );
      files[relative] = await command(
        "git",
        ["-C", repository, "show", `${commit}:${relative}`],
        { signal, trim: false },
      );
      requireValue(
        Buffer.byteLength(files[relative]) <= 1024 * 1024,
        "Source exceeds 1 MiB.",
      );
    }
    if (input.applicationId) {
      await checkOrigin(
        await workspace(config, input.applicationId),
        repository,
        signal,
      );
      return {
        commit: await command(
          "git",
          [
            "-C",
            await workspace(config, input.applicationId),
            "rev-parse",
            "HEAD",
          ],
          { signal },
        ),
        files: await filesAt(
          await workspace(config, input.applicationId),
          input.editablePaths,
        ),
      };
    }
    return { commit, files };
  }
  if (input.kind === "worktree") {
    const repository = await repositoryRoot(config, input.repository, signal);
    requireValue(
      /^[a-f0-9]{40,64}$/.test(input.commit),
      "Invalid source commit.",
    );
    const root = await privateDirectory(path.join(config.data, "worktrees"));
    const relative = id(input.applicationId);
    const location = await inside(root, relative, false);
    const branch = `dossier-${relative}`;
    const info = await lstat(location).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info) {
      await checkOrigin(location, repository, signal);
      requireValue(
        (await command("git", ["-C", location, "branch", "--show-current"], {
          signal,
        })) === branch,
        "Existing worktree has a different branch.",
      );
    } else
      await command(
        "git",
        [
          "-C",
          repository,
          "worktree",
          "add",
          "-b",
          branch,
          location,
          input.commit,
        ],
        { signal },
      );
    return { branch };
  }
  if (input.kind === "apply") {
    const root = await workspace(config, input.applicationId);
    const allowed = Object.keys(input.expected);
    requireValue(
      Array.isArray(input.files) &&
        input.files.length === allowed.length &&
        new Set(input.files.map((file) => file.path)).size === allowed.length,
      "Return each authorized file exactly once.",
    );
    const prepared = [];
    for (const file of input.files) {
      requireValue(
        allowed.includes(file.path) &&
          file.path.endsWith(".tex") &&
          typeof file.content === "string" &&
          Buffer.byteLength(file.content) <= 1024 * 1024,
        "Unauthorized or oversized replacement.",
      );
      const location = await inside(root, file.path);
      requireValue(
        digest(await readFile(location)) === input.expected[file.path],
        `${file.path} changed after launch. Start a fresh revision after reviewing the changes.`,
      );
      prepared.push([location, file.content]);
    }
    for (const [location, content] of prepared) await atomic(location, content);
    const diff = await command(
      "git",
      ["-C", root, "diff", "--no-ext-diff", "--", ...allowed],
      { signal },
    );
    return {
      diff,
      files: Object.fromEntries(
        input.files.map((file) => [file.path, file.content]),
      ),
    };
  }
  if (input.kind === "compile") {
    const root = await workspace(config, input.applicationId);
    requireValue(
      input.expected && typeof input.expected === "object",
      "Compilation needs a source snapshot.",
    );
    for (const [relative, expected] of Object.entries(input.expected)) {
      requireValue(
        relative.endsWith(".tex"),
        "Compile only authorized LaTeX sources.",
      );
      requireValue(
        digest(await readFile(await inside(root, relative))) === expected,
        `${relative} changed before compilation. Start a fresh preparation.`,
      );
    }
    await inside(root, input.entrypoint);
    requireValue(
      ["pdflatex", "xelatex", "lualatex"].includes(input.engine),
      "Unsupported LaTeX engine.",
    );
    const build = `.dossier-build/${id(operationId)}`;
    await inside(root, build, false);
    await privateDirectory(path.join(root, build));
    const args = [
      "-norc",
      { pdflatex: "-pdf", xelatex: "-xelatex", lualatex: "-lualatex" }[
        input.engine
      ],
      "-no-shell-escape",
      "-interaction=nonstopmode",
      "-halt-on-error",
      `-outdir=${build}`,
      input.entrypoint,
    ];
    const containerLua = config.container && input.engine === "lualatex";
    if (input.engine === "lualatex")
      // Lua's --safer breaks luaotfload; container mode uses filesystem isolation.
      args.splice(2, 0, containerLua
        ? "-pdflualatex=lualatex --nosocket %O %S"
        : "-pdflualatex=lualatex --safer %O %S");
    const log = await command("latexmk", args, {
      cwd: root,
      signal,
      env: { ...cliEnvironment(), openin_any: containerLua ? "a" : "p", openout_any: "p" },
    });
    const file = path.join(
      root,
      build,
      `${path.basename(input.entrypoint, ".tex")}.pdf`,
    );
    return {
      ...(await pdf(file, signal)),
      log,
      text: await command("pdftotext", [file, "-"], { signal }),
    };
  }
  if (input.kind === "pdf" || input.kind === "merge") {
    requireValue(
      Array.isArray(input.documents) &&
        input.documents.length > 0 &&
        input.documents.length <= 30,
      "Select between 1 and 30 PDFs.",
    );
    const sources = [];
    for (const [index, item] of input.documents.entries()) {
      const file = path.join(temporary, `${index}.pdf`);
      const data = Buffer.from(item.data, "base64");
      requireValue(
        data.length <= MAX_FILE && digest(data) === item.checksum,
        "PDF checksum mismatch or file too large.",
      );
      await writeFile(file, data, { mode: 0o600 });
      await pdf(file, signal);
      sources.push(file);
    }
    if (input.kind === "pdf")
      return {
        ...(await pdf(sources[0], signal)),
        text: await command("pdftotext", [sources[0], "-"], { signal }),
      };
    const file = path.join(temporary, "package.pdf");
    await command(
      process.env.DOSSIER_PYTHON_BIN || "python3",
      [
        fileURLToPath(new URL("./merge_pdfs.py", import.meta.url)),
        file,
        ...sources,
      ],
      { signal },
    );
    return pdf(file, signal, MAX_PACKAGE);
  }
  if (input.kind === "export" || input.kind === "reveal") {
    requireValue(
      typeof input.fileName === "string" &&
        /^[^/\\\x00-\x1f]+\.pdf$/.test(input.fileName) &&
        !input.fileName.startsWith("."),
      "Invalid package filename.",
    );
    const root = await privateDirectory(config.exports);
    const folder = await inside(root, id(input.folder), false);
    await privateDirectory(folder);
    const file = await inside(folder, input.fileName, false);
    const data = Buffer.from(input.data, "base64");
    requireValue(
      data.length <= MAX_PACKAGE && digest(data) === input.checksum,
      "Export checksum mismatch.",
    );
    requireValue(
      Number.isInteger(input.version) && input.version > 0,
      "Invalid package version.",
    );
    const archive = await inside(
      folder,
      input.fileName.replace(/\.pdf$/, `-v${input.version}.pdf`),
      false,
    );
    const prior = await readFile(archive).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    requireValue(
      !prior || digest(prior) === input.checksum,
      "An archive with different bytes already exists.",
    );
    if (!prior) await atomic(archive, data);
    await atomic(file, data);
    if (input.kind === "reveal") {
      const request = { kind: "reveal", folder: input.folder, fileName: input.fileName, checksum: input.checksum };
      if (config.hostUrl) await hostOperation(config, request, signal, operationId);
      else await revealExport(config, request, signal);
    }
    return { folder: input.folder, fileName: input.fileName };
  }
  throw new Error("Unknown worker operation.");
}
