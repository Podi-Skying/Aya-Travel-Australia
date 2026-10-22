import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { loadSnapshot, saveSnapshot, trimVersions, type VersionMeta } from "@/client/offline";
import { seedDoc } from "./helpers";
import { alertStatus } from "@/domain/rules";

/* AC10 (unit part). */

describe("offline store", () => {
  it("round-trips doc, sync time, alerts and versions, keeping docs only for 20 recent + v1", async () => {
    const doc = seedDoc();
    const versions: VersionMeta[] = Array.from({ length: 30 }, (_, k) => ({
      versionNo: 30 - k,
      summary: `v${30 - k}`,
      createdAt: new Date(2026, 9, 22, 12, k).toISOString(),
      restoredFrom: null,
      doc: { n: 30 - k },
    }));
    const alerts = alertStatus(doc, { showWindow: true });
    await saveSnapshot("trip:owner", { doc, versionNo: 30, lastSyncAt: "2026-10-22T12:00:00.000Z", alerts, versions });
    const back = await loadSnapshot<typeof doc, typeof alerts>("trip:owner");
    expect(back!.doc).toEqual(doc);
    expect(back!.lastSyncAt).toBe("2026-10-22T12:00:00.000Z");
    expect(back!.alerts).toEqual(alerts);
    const withDocs = back!.versions!.filter((v) => v.doc).map((v) => v.versionNo).sort((a, b) => a - b);
    expect(withDocs).toEqual([1, ...Array.from({ length: 20 }, (_, k) => 11 + k)]);
    expect(back!.versions).toHaveLength(30);
  });

  it("trimVersions keeps every entry's metadata", () => {
    const v = trimVersions([{ versionNo: 1, summary: "a", createdAt: "", restoredFrom: null, doc: 1 }], 0);
    expect(v[0].doc).toBe(1);
  });
});
