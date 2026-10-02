import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "scripts", "tests", ".github"];
const SELF = path.join("tests", "no-legacy-names.test.ts");
const EXT = /\.(ts|tsx|sql|css|json|yml|yaml|md|mjs)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("nomes legados", () => {
  it("nenhum arquivo do código menciona o projeto antigo", () => {
    const offenders = ROOTS.flatMap(walk)
      .filter((f) => EXT.test(f) && f !== SELF)
      .filter((f) => /barat[aã]o/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
