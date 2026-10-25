import { describe, it, expect } from "vitest";
import {
  interval,
  quietAdjusted,
  validateSubmission,
  owner,
  fm,
  csvCell,
} from "../server/domain.js";
describe("deterministic policy", () => {
  it("schedules Normal daily and Urgent/Critical every three hours", () => {
    expect(interval("Normal")).toBe(86400000);
    expect(interval("Urgent")).toBe(10800000);
    expect(interval("Critical")).toBe(10800000);
  });
  it("handles overnight quiet hours in IST", () => {
    expect(
      quietAdjusted(new Date("2026-10-25T18:30:00Z"), {
        quietStart: 22,
        quietEnd: 7,
      }).toISOString(),
    ).toBe("2026-10-26T01:30:00.000Z");
  });
  it("handles daytime quiet hours", () => {
    expect(
      quietAdjusted(new Date("2026-10-25T06:30:00Z"), {
        quietStart: 10,
        quietEnd: 14,
      }).toISOString(),
    ).toBe("2026-10-25T08:30:00.000Z");
  });
  it("rejects nonowners and non-FM approval", () => {
    expect(() => owner({ id: "x" }, { assignedToId: "y" })).toThrow();
    expect(() => fm({ role: "FOT" })).toThrow();
  });
  it("requires current-cycle ready evidence and corrective action", () => {
    const t = {
      status: "InProgress",
      cycle: 2,
      assignedToId: "u",
      beforeRequired: true,
      gpsRequired: true,
      cameraRequired: true,
    };
    const e = {
      cycle: 2,
      state: "Ready",
      userId: "u",
      source: "camera",
      latitude: 0,
      longitude: 0,
      accuracy: 0,
      gpsAt: new Date(),
    };
    expect(() =>
      validateSubmission(t, [], "Changed the damaged pipe"),
    ).toThrow();
    expect(() =>
      validateSubmission(
        t,
        [{ ...e, kind: "after" }],
        "Changed the damaged pipe",
      ),
    ).toThrow();
    expect(() =>
      validateSubmission(
        t,
        [
          { ...e, kind: "after" },
          { ...e, kind: "before" },
        ],
        "Changed the damaged pipe",
      ),
    ).not.toThrow();
    expect(() =>
      validateSubmission(
        t,
        [
          { ...e, kind: "after", cycle: 1 },
          { ...e, kind: "before" },
        ],
        "Changed the damaged pipe",
      ),
    ).toThrow();
  });
  it("neutralizes spreadsheet formulas in CSV", () => {
    expect(csvCell("=SUM(A1)")).toBe('"\'=SUM(A1)"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
});
