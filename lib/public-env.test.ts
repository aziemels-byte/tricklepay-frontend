import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const sourceExtensions = /\.(?:[cm]?[jt]sx?)$/;
const excludedDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "dist",
  "build",
  "playwright-report",
  "test-results",
]);
const excludedFiles = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        yield* sourceFiles(join(directory, entry.name));
      }
    } else if (
      entry.isFile() &&
      sourceExtensions.test(entry.name) &&
      !excludedFiles.test(entry.name)
    ) {
      yield join(directory, entry.name);
    }
  }
}

function isProcessEnv(expression: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "env" &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "process"
  );
}

/** Only real AST accesses count, not mentions in comments or prose. */
function publicEnvReads(source: string, fileName: string): Set<string> {
  const ast = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
      if (node.name.text.startsWith("NEXT_PUBLIC_")) names.add(node.name.text);
    }
    if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) {
      if (node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
        if (node.argumentExpression.text.startsWith("NEXT_PUBLIC_")) {
          names.add(node.argumentExpression.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return names;
}

describe("documented public environment variables (#470)", () => {
  it("detects dot and bracket access but ignores comments", () => {
    const names = publicEnvReads(
      [
        "// process.env.NEXT_PUBLIC_COMMENT_ONLY",
        "process.env.NEXT_PUBLIC_DOT;",
        'process.env["NEXT_PUBLIC_BRACKET"];',
        "process.env.NEXT_PRIVATE_EXCLUDED;",
      ].join("\n"),
      "example.ts",
    );
    expect([...names].sort()).toEqual([
      "NEXT_PUBLIC_BRACKET",
      "NEXT_PUBLIC_DOT",
    ]);
  });

  it("lists every public environment variable read by source code in .env.example", () => {
    const documented = new Set(
      [...readFileSync(join(root, ".env.example"), "utf8").matchAll(
        /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=/gm,
      )].map((match) => match[1]),
    );
    const missing = new Map<string, string[]>();

    for (const file of sourceFiles(root)) {
      const path = relative(root, file);
      for (const name of publicEnvReads(readFileSync(file, "utf8"), file)) {
        if (!documented.has(name)) {
          missing.set(name, [...(missing.get(name) ?? []), path]);
        }
      }
    }

    const failures = [...missing]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, paths]) => name + " referenced in " + paths.join(", "));

    expect(
      failures,
      "Add each missing NEXT_PUBLIC_* variable to .env.example: " +
        failures.join("; "),
    ).toEqual([]);
  });
});
