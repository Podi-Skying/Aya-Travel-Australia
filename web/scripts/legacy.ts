import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/* Loads the static prototype (site/) so seed and parity tests run on its real data and code. */

export const SITE_DIR = path.resolve(__dirname, "..", "..", "site");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LegacyData = any;

export function loadLegacyData(): LegacyData {
  const src = readFileSync(path.join(SITE_DIR, "js", "data.js"), "utf8");
  const sandbox: { window: { TRIP_DATA?: LegacyData } } = { window: {} };
  vm.runInNewContext(src, sandbox, { filename: "site/js/data.js" });
  if (!sandbox.window.TRIP_DATA) throw new Error("site/js/data.js did not define window.TRIP_DATA");
  return JSON.parse(JSON.stringify(sandbox.window.TRIP_DATA));
}

export function readLegacyApp(): string {
  return readFileSync(path.join(SITE_DIR, "js", "app.js"), "utf8");
}
