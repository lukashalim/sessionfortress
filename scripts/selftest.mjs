import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const dir = await mkdtemp(join(tmpdir(), "sf-test-"));
const outfile = join(dir, "selftest.js");

await build({
  entryPoints: ["scripts/selftest-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});

const mod = await import(pathToFileURL(outfile).href);
mod.run();
await rm(dir, { recursive: true, force: true });
assert.ok(true);
console.log("selftest: ok");
