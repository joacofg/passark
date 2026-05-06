#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2).filter((arg) => arg !== "--runInBand");
const result = spawnSync("npx", ["vitest", "run", ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
