// The main and server entries must never pull in rrweb: recording stays behind the separate,
// lazily imported "./recorder" entry. Follows the built files' static imports (run after build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

const dist = join(import.meta.dirname, "../dist");

function staticImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const code = readFileSync(join(dist, file), "utf8");
  for (const [, spec] of code.matchAll(/^\s*(?:import|export)\b[^"';]*?from\s+["']([^"']+)["']/gm)) {
    if (spec.startsWith("./")) staticImports(spec.slice(2), seen);
    else seen.add(spec);
  }
  return seen;
}

for (const entry of ["index.js", "server.js"]) {
  it(`${entry} does not import rrweb or the recorder`, () => {
    const imports = [...staticImports(entry)];
    assert.ok(imports.includes("protocol.js"), "import scan found the entry's dependencies");
    assert.deepEqual(imports.filter((spec) => /rrweb|recorder/.test(spec)), []);
  });
}
