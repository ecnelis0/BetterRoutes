import { describe, expect, it } from "vitest";
import { regionAt } from "../data/regions";
import { RIDE_IDEAS } from "./rideIdeas";
import { DEFAULT_HOME, reachFor, suggestRides, writeUp } from "./suggest";

const SF = { lat: 37.7749, lng: -122.4194 };

describe("ride ideas data", () => {
  it("every ride is complete, unique, sourced and starts in the Bay Area", () => {
    const ids = new Set<string>();
    for (const r of RIDE_IDEAS) {
      expect(ids.has(r.id), r.id).toBe(false);
      ids.add(r.id);
      expect(r.why.length, r.id).toBeGreaterThan(40);
      expect(r.plan.length, r.id).toBeGreaterThan(40);
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      for (const s of r.sources) expect(s, r.id).toMatch(/^https:\/\//);
      expect(r.tags.length, r.id).toBeGreaterThan(0);
      expect(r.miles, r.id).toBeGreaterThan(0);
      // Gilroy to Marin, Half Moon Bay to Sunol.
      expect(r.start.point.lat, r.id).toBeGreaterThan(36.9);
      expect(r.start.point.lat, r.id).toBeLessThan(38.0);
      expect(r.start.point.lng, r.id).toBeGreaterThan(-122.6);
      expect(r.start.point.lng, r.id).toBeLessThan(-121.4);
    }
  });

  it("a turnaround is mapped only where the app has a graph, in the same region as the start", () => {
    const withTurn = RIDE_IDEAS.filter((r) => r.turnaround);
    expect(withTurn.length).toBeGreaterThan(4);
    for (const r of withTurn) {
      expect(regionAt(r.start.point), r.id).not.toBeNull();
      expect(regionAt(r.turnaround!.point), r.id).toBe(regionAt(r.start.point));
    }
  });

  it("covers every distance from Evergreen, from ride-from-home to San Francisco", () => {
    const reaches = new Set(suggestRides({ limit: 100 }).map((s) => s.reach));
    expect([...reaches].sort()).toEqual(["day-trip", "far", "nearby", "short-drive"]);
  });
});

describe("suggestRides", () => {
  it("only offers rides within the reach asked for, closest first when likes tie", () => {
    const near = suggestRides({ maxReach: "nearby", limit: 100 });
    expect(near.length).toBeGreaterThan(1);
    for (const s of near) expect(s.milesFromHome).toBeLessThanOrEqual(8);
    const miles = near.map((s) => s.milesFromHome);
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
    expect(near.map((s) => s.ride.id)).not.toContain("golden-gate-sausalito");
  });

  it("ranks by how many of the rider's likes a ride has, over distance", () => {
    const [first] = suggestRides({ likes: ["coast", "food", "views", "water"] });
    // Sausalito has all four but is ~45 mi away; closer rides match fewer.
    expect(first.ride.id).toBe("golden-gate-sausalito");
    expect(first.matched.sort()).toEqual(["coast", "food", "views", "water"]);
  });

  it("respects difficulty both ways, surface and length", () => {
    const easyPaved = suggestRides({ maxDifficulty: "easy", surfaces: ["paved-path"], limit: 100 });
    expect(easyPaved.length).toBeGreaterThan(2);
    for (const s of easyPaved) {
      expect(s.ride.difficulty).toBe("easy");
      expect(s.ride.surface).toBe("paved-path");
    }
    const workout = suggestRides({ minDifficulty: "very-hard", surfaces: ["road"], limit: 100 });
    expect(workout.map((s) => s.ride.id)).toContain("mt-hamilton");
    for (const s of workout) expect(s.ride.difficulty).toBe("very-hard");
    for (const s of suggestRides({ maxMiles: 10, limit: 100 })) expect(s.ride.miles).toBeLessThanOrEqual(10);
  });

  it("measures from wherever home is: from San Francisco the SF rides are nearby", () => {
    const fromSf = suggestRides({ maxReach: "nearby", limit: 100 }, SF).map((s) => s.ride.id);
    expect(fromSf).toContain("golden-gate-park-sunset-dunes");
    expect(fromSf).not.toContain("coyote-creek-trail");
  });

  it("says when the app can route to a ride's start, and when it cannot", () => {
    const all = suggestRides({ limit: 100 });
    const byId = new Map(all.map((s) => [s.ride.id, s]));
    expect(byId.get("sf-waterfront")!.routableIn).toBe("sf");
    expect(byId.get("coyote-creek-trail")!.routableIn).toBe("sanjose");
    expect(byId.get("tunitas-creek")!.routableIn).toBeNull();
    for (const s of all) expect(s.routableIn).toBe(regionAt(s.ride.start.point));
  });

  it("buckets distance at the edges", () => {
    expect(reachFor(0)).toBe("nearby");
    expect(reachFor(8)).toBe("nearby");
    expect(reachFor(8.1)).toBe("short-drive");
    expect(reachFor(40.1)).toBe("far");
    expect(DEFAULT_HOME.name).toMatch(/Evergreen/);
  });

  it("returns nothing rather than something wrong when nothing fits", () => {
    expect(suggestRides({ maxReach: "nearby", minDifficulty: "very-hard", surfaces: ["dirt"] })).toEqual([]);
  });

  it("writes a ride up with its level, plan, transit, cautions and what the app can do", () => {
    const all = new Map(suggestRides({ limit: 100 }).map((s) => [s.ride.id, s]));
    const ggb = writeUp(all.get("golden-gate-sausalito")!, "Evergreen", "sanjose");
    expect(ggb.split("\n")[0]).toBe("Golden Gate Bridge to Sausalito (ferry back) - San Francisco → Marin");
    expect(ggb).toContain("Moderate, road, about 9 mi and 500 ft of climbing.");
    expect(ggb).toContain("Getting there: Caltrain");
    expect(ggb).toContain("Watch out:");
    expect(ggb).toMatch(/switch the map to San Francisco/);
    expect(writeUp(all.get("golden-gate-sausalito")!, "Evergreen", "sf")).toMatch(/ask and I will map it, Aquatic Park, San Francisco to Golden Gate Bridge Welcome Center\.$/);
    expect(writeUp(all.get("sierra-road")!, "Evergreen", "sanjose")).toMatch(/ask and I will map the way to the start\.$/);
    const ham = writeUp(all.get("mt-hamilton")!, "Evergreen", "sanjose");
    expect(ham).toContain("4,300 ft");
    expect(ham).not.toContain("Getting there");
    expect(writeUp(all.get("tunitas-creek")!, "Evergreen", "sanjose")).toMatch(/no maps there yet/);
  });
});
