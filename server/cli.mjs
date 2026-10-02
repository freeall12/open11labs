#!/usr/bin/env node
/**
 * Entry point for the local BYOK server.
 *
 *   node server/cli.mjs --port 5173 --root dist
 *   node server/cli.mjs --data ./data
 *
 * Binds loopback only. There is no --host escape hatch on purpose: exposing
 * this server to a LAN would publish the key vault, and the docs call that
 * out as a thing this release does not do.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalServer } from "./index.mjs";
import { Vault } from "./lib/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const port = Number(arg("port", process.env.PORT ?? 5173));
const root = resolve(arg("root", join(repoRoot, "dist")));
const dataDir = resolve(arg("data", join(repoRoot, "data")));

// A master password is opt-in. Without it the vault is memory-only and keys
// are lost on restart, which is the safer default.
const masterPassword = process.env.EL_MASTER_PASSWORD || null;

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error(`invalid port: ${port}`);
  process.exit(1);
}

if (!existsSync(root)) {
  console.error(`web build not found at ${root} — run \`npm run build\` first`);
  process.exit(1);
}

const vault = new Vault({ masterPassword });
const { server, jobs } = createLocalServer({
  root,
  vault,
  port,
  dbPath: join(dataDir, "db", "meta.db"),
});

server.listen(port, "127.0.0.1", () => {
  console.log(`open11labs local server  http://127.0.0.1:${port}`);
  console.log(`  web root : ${root}`);
  console.log(`  data dir : ${dataDir}`);
  console.log(`  vault    : ${vault.isPersistent ? "encrypted at rest" : "memory only (restart clears keys)"}`);
  console.log(`  jobs db  : ${join(dataDir, "db", "meta.db")}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
