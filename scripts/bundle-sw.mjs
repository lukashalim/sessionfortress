import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await mkdir(resolve(root, "dist"), { recursive: true });

await build({
  entryPoints: [resolve(root, "src/sw.ts")],
  bundle: true,
  format: "esm",
  outfile: resolve(root, "dist/sw.js"),
  target: "chrome120",
  platform: "browser",
  logLevel: "info",
});

await copyFile(resolve(root, "manifest.json"), resolve(root, "dist/manifest.json"));
