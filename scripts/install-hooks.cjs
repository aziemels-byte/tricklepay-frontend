#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
const actualRoot = path.resolve(git(["rev-parse", "--show-toplevel"]));
if (actualRoot !== root) {
  throw new Error("Run this installer in a clone of the repository.");
}
let customHooks = "";
try {
  customHooks = git(["config", "--get", "core.hooksPath"]);
} catch {
  // The local repository uses Git's default .git/hooks directory.
}
if (customHooks) {
  throw new Error(
    "core.hooksPath is already configured (" + customHooks +
    "). Install the hook manually rather than overriding existing hooks.",
  );
}

const relativePath = git(["rev-parse", "--git-path", "hooks/pre-commit"]);
const hookFile = path.resolve(root, relativePath);
const content =
  "#!/bin/sh\n" +
  "# TricklePay frontend (#469) opt-in pre-commit quality gate.\n" +
  "exec node scripts/pre-commit.cjs\n";

if (fs.existsSync(hookFile) && fs.readFileSync(hookFile, "utf8") !== content) {
  throw new Error(
    "An existing pre-commit hook was found at " + hookFile +
    ". It was left unchanged. Integrate scripts/pre-commit.cjs manually.",
  );
}
fs.mkdirSync(path.dirname(hookFile), { recursive: true });
fs.writeFileSync(hookFile, content, { mode: 0o755 });
fs.chmodSync(hookFile, 0o755);
console.log("Installed pre-commit hook: " + hookFile);
