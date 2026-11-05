import { describe, expect, it } from "vitest";
import { buildElevationRibbon, gradeColor, ribbonAt } from "./elevationRibbon";

// Due north: 0.001 degrees of latitude is about 111m.
const line = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 37.3 + i * 0.001, lng: -121.9 }));

describe("buildElevationRibbon", () => {
  it("draws nothing rather than guess when elevations do not match the path", () => {
    expect(buildElevationRibbon(line(3), undefined)).toBeNull();
    expect(buildElevationRibbon(line(3), [1, 2])).toBeNull();
  });

  it("stands taller where the road is higher", () => {
    const r = buildElevationRibbon(line(4), [10, 50, 90, 50])!;
    expect(r.points[2].wallMeters).toBeGreaterThan(r.points[1].wallMeters);
    expect(r.points[1].wallMeters).toBeGreaterThan(r.points[0].wallMeters);
    expect(r.highest.elevation).toBe(90);
    expect(r.highest.along).toBeCloseTo(r.points[2].along);
    expect(r.lowest.elevation).toBe(10);
  });

  it("keeps a big climb within the drawn range", () => {
    const r = buildElevationRibbon(line(3), [0, 300, 600])!;
    const walls = r.points.map((p) => p.wallMeters);
    expect(Math.max(...walls) - Math.min(...walls)).toBeCloseTo(100);
  });

  it("does not turn a flat ride's noise into a mountain", () => {
    const r = buildElevationRibbon(line(3), [20, 22, 21])!;
    const walls = r.points.map((p) => p.wallMeters);
    // 2m of real range at the maximum 4x magnification, not stretched to 100m.
    expect(Math.max(...walls) - Math.min(...walls)).toBeCloseTo(8);
  });

  it("survives a perfectly flat route", () => {
    const r = buildElevationRibbon(line(3), [5, 5, 5])!;
    expect(r.points.every((p) => Number.isFinite(p.wallMeters))).toBe(true);
    expect(r.points.every((p) => p.gradePercent === 0)).toBe(true);
  });

  it("reads grade in the direction of travel", () => {
    const up = buildElevationRibbon(line(3), [0, 11, 22])!;
    const down = buildElevationRibbon(line(3), [22, 11, 0])!;
    expect(up.points[1].gradePercent).toBeGreaterThan(9);
    expect(down.points[1].gradePercent).toBeLessThan(-9);
  });

  it("measures grade over enough road that one bad sample is not a wall", () => {
    // Vertices 5m apart: a 2m DEM blip on one is 40% across that single gap.
    const dense = Array.from({ length: 21 }, (_, i) => ({ lat: 37.3 + i * 0.000045, lng: -121.9 }));
    const elev = dense.map((_, i) => (i === 10 ? 12 : 10));
    const r = buildElevationRibbon(dense, elev)!;
    expect(Math.max(...r.points.map((p) => Math.abs(p.gradePercent)))).toBeLessThan(10);
  });
});

describe("gradeColor", () => {
  it("runs green on the flat to red on a steep climb, whichever way the road tilts", () => {
    const [fr, fg] = gradeColor(0);
    const [sr, sg] = gradeColor(10);
    expect(fg).toBeGreaterThan(fr);
    expect(sr).toBeGreaterThan(sg);
    expect(gradeColor(-10)).toEqual(gradeColor(10));
  });

  it("does not run off the end of the scale", () => {
    gradeColor(40).forEach((v, i) => expect(v).toBeCloseTo(gradeColor(15)[i]));
  });
});

describe("ribbonAt", () => {
  const r = buildElevationRibbon(line(3), [10, 20, 30])!;

  it("interpolates between vertices", () => {
    const mid = ribbonAt(r.points, r.points[1].along / 2);
    expect(mid.elevation).toBeCloseTo(15);
    expect(mid.lat).toBeCloseTo((r.points[0].lat + r.points[1].lat) / 2);
  });

  it("clamps to the ends", () => {
    expect(ribbonAt(r.points, -5).elevation).toBe(10);
    expect(ribbonAt(r.points, 1e9).elevation).toBe(30);
  });
});
