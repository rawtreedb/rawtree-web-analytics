// Bundle-size report from dist/meta.json (written by the chunk-meta plugin in vite.config.ts):
// eager JS (the entry plus its static imports, loaded before recording consent) and lazy
// chunks (the recorder with rrweb). Fails if rrweb is in an eager chunk or no lazy chunk has it.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

type Chunk = { file: string; isEntry: boolean; imports: string[]; dynamicImports: string[]; modules: string[] };

const dist = join(import.meta.dirname, "../dist");
const chunks = JSON.parse(
  await readFile(join(dist, "meta.json"), "utf8").catch(() => {
    throw new Error("dist/meta.json is missing: run `npm run build` first");
  }),
) as Chunk[];
const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));

const eager = new Set<string>();
const visit = (file: string) => {
  if (eager.has(file)) return;
  eager.add(file);
  for (const next of byFile.get(file)?.imports ?? []) visit(next);
};
for (const chunk of chunks) if (chunk.isEntry) visit(chunk.file);
const lazy = chunks.map((chunk) => chunk.file).filter((file) => !eager.has(file));

const hasRrweb = (file: string) => (byFile.get(file)?.modules ?? []).some((id) => /node_modules\/(rrweb|@rrweb)\//.test(id));
const sizeOf = (code: Buffer) => ({ min: code.byteLength, gzip: gzipSync(code, { level: 9 }).byteLength });

const rows: { bundle: string; "min bytes": number; "gzip bytes": number }[] = [];
const add = (bundle: string, code: Buffer) => {
  const size = sizeOf(code);
  rows.push({ bundle, "min bytes": size.min, "gzip bytes": size.gzip });
};
const eagerCode: Buffer[] = [];
for (const file of eager) {
  const code = await readFile(join(dist, file));
  eagerCode.push(code);
  add(`eager ${file}`, code);
}
if (eager.size > 1) add("eager total", Buffer.concat(eagerCode));
for (const file of lazy) add(`lazy ${hasRrweb(file) ? "recorder+rrweb" : "chunk"} ${file}`, await readFile(join(dist, file)));
console.table(rows);

const failures: string[] = [];
for (const file of eager) if (hasRrweb(file)) failures.push(`rrweb is bundled in eager chunk ${file}`);
if (!lazy.some(hasRrweb)) failures.push("no lazy chunk contains rrweb (recorder not split?)");
const sdkInEager = [...eager].some((file) => byFile.get(file)?.modules.some((id) => id.includes("node_modules/@rawtree/analytics/dist/")));
if (!sdkInEager) failures.push("the eager bundle did not resolve the packed SDK from node_modules");
if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("OK rrweb is absent from the eager bundle; the recorder chunk is lazy; the SDK comes from the packed tarball");
