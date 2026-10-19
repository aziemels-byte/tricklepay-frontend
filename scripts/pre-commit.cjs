#!/usr/bin/env node
"use strict";

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
process.chdir(root);

if (process.env.SKIP_TRICKLEPAY_HOOKS === "1") {
  console.log("[pre-commit] Skipped by SKIP_TRICKLEPAY_HOOKS=1.");
  process.exit(0);
}

// -z keeps spaces, quotes and newlines in file names unambiguous. Read the
// index, not the working-tree diff, and ignore deleted/renamed-away files.
const staged = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const source = staged.filter(
  (file) =>
    /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.test(file) &&
    fs.existsSync(path.join(root, file)),
);

if (source.length === 0) {
  console.log("[pre-commit] No staged JS/TS files; checks not needed.");
  process.exit(0);
}

function packageBinary(packageName, relativeBin) {
  try {
    return path.join(
      path.dirname(require.resolve(packageName + "/package.json")),
      relativeBin,
    );
  } catch {
    console.error("[pre-commit] Dependencies missing. Run npm ci first.");
    process.exit(1);
  }
}

function run(label, args) {
  console.log("[pre-commit] " + label);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    console.error("[pre-commit] " + result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("[pre-commit] " + label + " failed. Commit aborted.");
    process.exit(result.status || 1);
  }
}

// TypeScript includes project-wide dependencies: limiting tsc to changed
// paths would ignore tsconfig and break module alias resolution.
run("Type-check project", [packageBinary("typescript", "bin/tsc"), "--noEmit"]);
// ESLint receives only staged source paths as separate process arguments;
// passing an argument array avoids shell interpretation of file names.
run("Lint staged source files", [
  packageBinary("eslint", "bin/eslint.js"),
  ...source,
]);
console.log("[pre-commit] Typecheck and staged-file lint passed.");
