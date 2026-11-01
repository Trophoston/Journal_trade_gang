import { describe, expect, it } from "vitest";
import { subscribe, type LiveEvent } from "./bus";
import { markLost, markSeen } from "./presence";

describe("presence", () => {
  it("announces connect and disconnect once per transition", () => {
    const seen: LiveEvent[] = [];
    const off = subscribe((e) => seen.push(e));
    const a = { _id: "a-presence-test", name: "Gold", login: 123, eaVersion: "metaapi" };
    markSeen(a);
    markSeen(a); // still online: no second "connected"
    markLost(a, "broker login failed");
    markLost(a); // already offline: nothing
    markSeen(a);
    off();
    const status = seen.filter((e) => e.type === "ea.status").map((e) => (e.type === "ea.status" ? [e.connected, e.via, e.reason] : null));
    expect(status).toEqual([
      [true, "metaapi", undefined],
      [false, "metaapi", "broker login failed"],
      [true, "metaapi", undefined],
    ]);
  });
});
