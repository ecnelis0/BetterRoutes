import { describe, expect, it } from "vitest";
import { getRoutingEngine, planCustomPath, planRoutes, regionForTrip, RoutingError, summarizeCustom } from "./service";
import { describeRoute } from "../ui/routeDescription";
import { choosePlaces, nearestPlace, planInterestRoutes, type Poi } from "../interests/planner";
import sanJosePois from "../data/sanjose/pois.json";

const SAP_CENTER = { lat: 37.3327, lng: -121.9012 };
const SJSU = { lat: 37.3352, lng: -121.8811 };
const JAPANTOWN = { lat: 37.3489, lng: -121.8949 };
const SANTANA_ROW = { lat: 37.321, lng: -121.948 };
const ALMADEN_LAKE = { lat: 37.238, lng: -121.88 };
const ALVISO = { lat: 37.428, lng: -121.979 };
const FERRY_BUILDING = { lat: 37.7955, lng: -122.3937 };
const OCEAN_BEACH = { lat: 37.7562, lng: -122.5102 };

describe("San José engine", () => {
  const eng = getRoutingEngine("sanjose");

  it("is its own graph, with San José's data and none of SF's safety rules", () => {
    expect(eng.region).toBe("sanjose");
    expect(eng.graph.nodes.length).not.toBe(getRoutingEngine("sf").graph.nodes.length);
    expect(eng.crashCount).toBe(0);
    expect(eng.hotspots).toEqual([]);
    expect(eng.inFlaggedArea.some((v) => v !== 0)).toBe(false);
  });

  it("loads the region's own trained scores", () => {
    expect(eng.modelSource).toBe("trained");
    expect(eng.scores.length).toBe(eng.graph.edges.length);
  });

  it("has scores spread enough for the profiles to differ, and few hard-avoid edges", () => {
    // ml/README.md: compressed scores make all profiles alike; saturated ones
    // trip the hard-avoid ceilings and disconnect the graph.
    const sorted = Float32Array.from(eng.scores).sort();
    const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))];
    expect(at(0.95) - at(0.05)).toBeGreaterThan(30);
    expect(eng.scores.filter((s) => s >= 80).length / eng.scores.length).toBeLessThan(0.02);
  });

  it("marks surveyed protected lanes on the graph", () => {
    expect(eng.laneMatch.matched).toBeGreaterThan(50_000);
    expect(eng.graph.edges.filter((e) => e.tier === "fullyProtected").length).toBeGreaterThan(20_000);
  });

  it("does not pair SF's named steep streets with San José's same-named ones", () => {
    expect(eng.steepSeverity.every((s) => s === null)).toBe(true);
  });

  it("matched real signals onto intersections", () => {
    expect(eng.signalsMatched).toBeGreaterThan(1000);
  });
});

describe("routing in San José", () => {
  it("plans all three options from coordinates alone", () => {
    const routes = planRoutes(SANTANA_ROW, SJSU);
    expect(routes.map((r) => r.profile).sort()).toEqual(["balanced", "fastest", "safest"]);
    for (const r of routes) {
      expect(r.distanceMeters).toBeGreaterThan(5000);
      expect(r.path.every((p) => p.lat > 37.14 && p.lat < 37.47 && p.lng > -122.07 && p.lng < -121.7)).toBe(true);
      expect(r.pathElevations?.length).toBe(r.path.length);
    }
  });

  it("keeps Safest + bike lanes on more protected lane than Fastest", () => {
    const trips = [
      [ALVISO, SAP_CENTER],
      [SANTANA_ROW, SJSU],
      [ALMADEN_LAKE, SAP_CENTER],
      [JAPANTOWN, ALMADEN_LAKE],
    ] as const;
    const gains = trips.map(([a, b]) => {
      const routes = planRoutes(a, b);
      const fastest = routes.find((r) => r.profile === "fastest")!;
      const safest = routes.find((r) => r.profile === "safest")!;
      expect(safest.distanceMeters).toBeLessThan(fastest.distanceMeters * 1.4);
      return safest.protectedLaneFraction - fastest.protectedLaneFraction;
    });
    // Not per trip: from Alviso, staying away from freeways already puts Fastest
    // on the river trail, so both options rightly come out the same.
    for (const g of gains) expect(g).toBeGreaterThanOrEqual(-0.02);
    expect(gains.reduce((t, g) => t + g, 0) / gains.length).toBeGreaterThan(0.2);
  });

  it("gets real elevation: Almaden is higher than downtown, and nothing is below the bay", () => {
    const eng = getRoutingEngine("sanjose");
    const near = (p: { lat: number; lng: number }) => eng.nodeElevation[eng.index.nearest(p)!];
    expect(near(ALMADEN_LAKE)).toBeGreaterThan(near(SAP_CENTER));
    expect(Math.min(...eng.nodeElevation.subarray(0, 50_000))).toBeGreaterThanOrEqual(0);
  });

  it("does not read culverts and bridge decks on the valley floor as walls", () => {
    // Downtown to Almaden is valley floor: ~150ft over 7 miles. Before spikes
    // and spans were handled this ride reported a 16% climb.
    const fastest = planRoutes(ALMADEN_LAKE, SJSU).find((r) => r.profile === "fastest")!;
    expect(fastest.maxGradePercent).toBeLessThan(10);
  });

  it("keeps real hills steep: the climb into the east foothills survives smoothing", () => {
    const eng = getRoutingEngine("sanjose");
    const steep = eng.graph.edges.filter(
      (e) => e.lengthMeters >= 40 && Math.abs(eng.climbMeters[e.id]) / e.lengthMeters >= 0.1
    );
    expect(steep.length).toBeGreaterThan(1000);
  });

  it("makes no claim about dangerous areas it has no data on", () => {
    for (const r of planRoutes(SANTANA_ROW, SJSU)) {
      expect(r.noSafetyData).toBe(true);
      expect(r.neighborhoodsEntered).toEqual([]);
      const text = describeRoute(r, "30").choices.map((c) => c.text).join(" | ");
      expect(text).not.toMatch(/Severe|crash hotspot|dangerous areas|High and Elevated/);
      expect(r.detourWarning?.message ?? "").not.toMatch(/flagged/);
    }
  });

  it("edits a route with a stop, staying in the region", () => {
    const plan = planCustomPath(SANTANA_ROW, SJSU, [JAPANTOWN], "safest");
    const summary = summarizeCustom(plan, [JAPANTOWN], "safest");
    expect(summary.noSafetyData).toBe(true);
    expect(summary.distanceMeters).toBeGreaterThan(planRoutes(SANTANA_ROW, SJSU)[0].distanceMeters);
  });

  it("finds places of interest in San José", () => {
    const hit = nearestPlace("coffee", { near: JAPANTOWN });
    expect(hit).not.toBeNull();
    expect(hit!.lat).toBeLessThan(37.47);
  });
});

describe("freeways in San José", () => {
  const FREEWAY = /\b(expressway|expwy|expy|freeway|fwy)\b/i;
  const CAR_FREE = new Set(["cycleway", "path"]);
  const TRIPS = [
    [ALMADEN_LAKE, SJSU],
    [ALVISO, SAP_CENTER],
    [SANTANA_ROW, SJSU],
    [{ lat: 37.3163, lng: -121.7732 }, SJSU], // Evergreen, across 101 and 680
    [{ lat: 37.3639, lng: -121.9289 }, SANTANA_ROW],
  ] as const;

  it("has no freeway or expressway road anywhere in the graph", () => {
    const bad = getRoutingEngine("sanjose").graph.edges.filter(
      (e) => e.name && FREEWAY.test(e.name) && !CAR_FREE.has(e.roadClass)
    );
    expect([...new Set(bad.map((e) => e.name))]).toEqual([]);
  });

  it("keeps every option off them, on real trips", () => {
    for (const [a, b] of TRIPS) {
      for (const r of planRoutes(a, b)) {
        expect(r.streets.filter((s) => FREEWAY.test(s)), r.label).toEqual([]);
      }
    }
  });

  it("can still get across town: the freeways are crossed, not walls", () => {
    for (const [a, b] of TRIPS) expect(planRoutes(a, b).length).toBe(3);
  });

  it("charges for riding beside one, on Fastest too", () => {
    const eng = getRoutingEngine("sanjose");
    expect(eng.graph.edges.filter((e) => e.alongFreeway).length).toBeGreaterThan(1000);
    for (const [a, b] of TRIPS) {
      for (const r of planRoutes(a, b)) {
        // Almost none, and what is left is reported on the route.
        expect(r.metersAlongFreeway / r.distanceMeters, r.label).toBeLessThan(0.05);
      }
    }
  });

  it("says so on the route, in plain words", () => {
    const [r] = planRoutes(SANTANA_ROW, SJSU);
    const text = describeRoute(r, "30").choices.map((c) => c.text).join(" | ");
    expect(text).toMatch(/Stays off/);
  });

  it("leaves SF's graph without the flag: its routes and results stand", () => {
    expect(getRoutingEngine("sf").graph.edges.some((e) => e.alongFreeway)).toBe(false);
  });
});

describe("real places in San José", () => {
  it("knows its landmarks, and has no furniture listed as a park", () => {
    const history = nearestPlace("landmark", { near: { lat: 37.3304, lng: -121.8905 } });
    expect(history).not.toBeNull();
    const parks = sanJosePois.pois.filter((p) => p.category === "park");
    expect(parks.length).toBeGreaterThan(200);
    expect(parks.filter((p) => /\b(bench|exercise bar)\b/i.test(p.name))).toEqual([]);
  });

  it("marks well-known places, and only the ones with their own entry", () => {
    const notable = sanJosePois.pois.filter((p) => "notable" in p && p.notable);
    expect(notable.length).toBeGreaterThan(20);
    expect(notable.length).toBeLessThan(sanJosePois.pois.length / 2);
  });

  it("builds a landmark ride with real stops along the way", () => {
    const rides = planInterestRoutes(SANTANA_ROW, JAPANTOWN, ["landmark"]);
    const stops = rides.flatMap((r) => r.stops);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((s) => s.category === "landmark")).toBe(true);
  });

  it("prefers a well-known place over a slightly closer unknown one", () => {
    const line = [
      { lat: 37.3, lng: -121.9 },
      { lat: 37.34, lng: -121.9 },
    ];
    const here = (id: string, lng: number, notable: boolean): Poi => ({
      id,
      category: "landmark",
      name: id,
      lat: 37.32,
      lng,
      ...(notable ? { notable } : {}),
    });
    // ~90m and ~270m off the line.
    const near = here("unknown", -121.899, false);
    const far = here("famous", -121.897, true);
    const [pick] = choosePlaces([near, far], ["landmark"], line, 4450, "relaxed");
    expect(pick.id).toBe("famous");
    const [plain] = choosePlaces([near, { ...far, notable: false }], ["landmark"], line, 4450, "relaxed");
    expect(plain.id).toBe("unknown");
  });
});

describe("trips across regions", () => {
  it("says so plainly rather than failing to snap", () => {
    expect(() => planRoutes(FERRY_BUILDING, SJSU)).toThrow(RoutingError);
    expect(() => planRoutes(FERRY_BUILDING, SJSU)).toThrow(/San Francisco and San José/);
    expect(() => planCustomPath(SAP_CENTER, SJSU, [FERRY_BUILDING], "safest")).toThrow(/can't cross/);
  });

  it("leaves San Francisco routing exactly where it was", () => {
    expect(regionForTrip([FERRY_BUILDING, OCEAN_BEACH])).toBe("sf");
    const routes = planRoutes(OCEAN_BEACH, FERRY_BUILDING);
    expect(routes.every((r) => r.noSafetyData === undefined)).toBe(true);
    expect(routes.find((r) => r.profile === "safest")!.path.every((p) => p.lat > 37.7)).toBe(true);
  });

  it("still refuses points outside every region the old way", () => {
    expect(() => planRoutes({ lat: 37.8044, lng: -122.2712 }, { lat: 37.87, lng: -122.27 })).toThrow(/not near any/);
  });
});
