import test from "node:test";
import assert from "node:assert/strict";
import { latestSlot } from "../src/schedule.js";
test("Shanghai scheduler targets current evening and preceding NAV day next morning, including year boundary", () => {
  for (const [at, slot, day] of [
    ["2025-12-31T15:11:00Z", "2025-12-31T23:10", "2025-12-31"],
    ["2025-12-31T19:00:00Z", "2025-12-31T23:10", "2025-12-31"],
    ["2026-01-01T00:10:00Z", "2026-01-01T08:10", "2025-12-31"],
    ["2026-01-01T13:10:00Z", "2026-01-01T21:10", "2026-01-01"],
  ])
    assert.deepEqual(latestSlot(new Date(at)), { slot, day });
});
