import { describe, expect, it } from "vitest";
import { createPermissionDataSource } from "./store";
import type { PermissionData } from "./types";

const data = (marker: string): PermissionData => ({ roleAssignments: [{ id: marker, userId: "u", roleId: "r" }], rolePermissions: [] });

function harness(ttlMs = 1000) {
  let clock = 0;
  const calls: string[] = [];
  let next = "v1";
  let failNext = false;
  let hold: Promise<void> | undefined;
  const source = createPermissionDataSource({
    ttlMs,
    now: () => clock,
    load: async () => {
      const value = next; // what the database held when this load began
      calls.push(value);
      if (hold) await hold;
      if (failNext) {
        failNext = false;
        throw new Error("db down");
      }
      return data(value);
    }
  });
  return {
    source,
    calls,
    advance: (ms: number) => (clock += ms),
    setNext: (value: string) => (next = value),
    failNext: () => (failNext = true),
    holdLoads: () => {
      let release!: () => void;
      hold = new Promise<void>((resolve) => (release = resolve));
      return () => {
        hold = undefined;
        release();
      };
    }
  };
}

describe("permission data source", () => {
  it("serves from cache within the TTL and reloads after it", async () => {
    const h = harness(1000);
    expect((await h.source.get()).roleAssignments[0]!.id).toBe("v1");
    h.setNext("v2");
    h.advance(999);
    expect((await h.source.get()).roleAssignments[0]!.id).toBe("v1");
    h.advance(2);
    expect((await h.source.get()).roleAssignments[0]!.id).toBe("v2");
    expect(h.calls).toEqual(["v1", "v2"]);
  });

  it("shares one load between concurrent callers", async () => {
    const h = harness();
    const results = await Promise.all([h.source.get(), h.source.get(), h.source.get()]);
    expect(h.calls).toHaveLength(1);
    expect(results[0]).toBe(results[2]);
  });

  it("invalidate forces the next read to see the change", async () => {
    const h = harness(60_000);
    await h.source.get();
    h.setNext("v2");
    h.source.invalidate();
    expect((await h.source.get()).roleAssignments[0]!.id).toBe("v2");
  });

  it("does not cache or share a load that started before an invalidation", async () => {
    const h = harness(60_000);
    const release = h.holdLoads();
    const stale = h.source.get(); // loading "v1", held open
    h.setNext("v2");
    h.source.invalidate(); // the change happened while that load was running
    release();
    const fresh = await h.source.get();
    expect((await stale).roleAssignments[0]!.id).toBe("v1");
    expect(fresh.roleAssignments[0]!.id).toBe("v2");
    // And what is now cached is the fresh copy, not the stale one.
    expect((await h.source.get()).roleAssignments[0]!.id).toBe("v2");
  });

  it("never serves an expired copy when the refresh fails, and recovers afterwards", async () => {
    const h = harness(1000);
    await h.source.get();
    h.advance(5000);
    h.failNext();
    await expect(h.source.get()).rejects.toThrow("db down");
    // Not cached: the next call tries again and succeeds.
    expect((await h.source.get()).roleAssignments[0]!.id).toBe("v1");
    expect(h.calls).toHaveLength(3);
  });
});
