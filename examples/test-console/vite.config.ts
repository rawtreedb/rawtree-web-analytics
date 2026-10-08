import { relative } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Writes dist/meta.json (chunk -> static imports, dynamic imports, source modules) so
// scripts/size.ts can tell eager chunks from lazy ones and find where rrweb ended up.
const chunkMeta = (): Plugin => ({
  name: "chunk-meta",
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).flatMap((item) =>
      item.type === "chunk"
        ? [{ file: item.fileName, isEntry: item.isEntry, imports: item.imports, dynamicImports: item.dynamicImports, modules: item.moduleIds.map((id) => relative(import.meta.dirname, id)) }]
        : [],
    );
    this.emitFile({ type: "asset", fileName: "meta.json", source: JSON.stringify(chunks, null, 2) });
  },
});

export default defineConfig({
  plugins: [tailwindcss(), chunkMeta()],
  // Tailwind runs through the @tailwindcss/vite plugin; pin an empty PostCSS config so
  // Vite does not pick up the Next.js app's root postcss.config.mjs.
  css: { postcss: { plugins: [] } },
  build: { sourcemap: false },
});
