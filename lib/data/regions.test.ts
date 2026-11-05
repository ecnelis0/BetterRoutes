import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { regionAt, REGION_IDS, REGIONS } from "./regions";
import { COVERAGE_BOUNDS } from "./coverage";

describe("regions", () => {
  it("keeps San Francisco's box identical to its routing coverage", () => {
    expect(REGIONS.sf.bounds).toEqual(COVERAGE_BOUNDS);
  });

  it("matches the box San José's graph was actually fetched for", () => {
    // Same failure coverage.test.ts guards in SF: a geocoder box that has
    // drifted from the graph returns places the router cannot reach.
    const file = path.join(process.cwd(), "lib", "data", "sanjose", "bikeGraph.json");
    const graph = JSON.parse(readFileSync(file, "utf8")) as { bounds: unknown };
    expect(graph.bounds).toEqual(REGIONS.sanjose.bounds);
  });

  it("has no overlapping regions, so a point has one answer", () => {
    for (const a of REGION_IDS) {
      for (const b of REGION_IDS) {
        if (a === b) continue;
        const A = REGIONS[a].bounds;
        const B = REGIONS[b].bounds;
        const overlap = A.south < B.north && B.south < A.north && A.west < B.east && B.west < A.east;
        expect(overlap, `${a} / ${b}`).toBe(false);
      }
    }
  });

  it("finds each region from a point in it, and none from outside", () => {
    expect(regionAt({ lat: 37.7749, lng: -122.4194 })).toBe("sf");
    expect(regionAt({ lat: 37.3337, lng: -121.8907 })).toBe("sanjose");
    expect(regionAt({ lat: 37.8044, lng: -122.2712 })).toBeNull(); // Oakland, not yet
  });

  it("centres each region inside its own box", () => {
    for (const id of REGION_IDS) expect(regionAt(REGIONS[id].center)).toBe(id);
  });
});
