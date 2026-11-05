import { describe, expect, it } from "vitest";
import { applyLaneTiers } from "./laneMatch";
import { REAL_SF_BIKE_LANES } from "../dataSources/sfmtaBikeLanes";
import { getRoutingEngine } from "../routing/service";
import type { GraphEdge } from "../routing/graph";
import type { BikeLaneSegment, LatLng } from "../types";

describe("applyLaneTiers", () => {
  // Two edges 400m apart; one sits on a protected facility, one nowhere near.
  function fixture() {
    const nodes: LatLng[] = [
      { lat: 37.77, lng: -122.42 },
      { lat: 37.7705, lng: -122.42 },
      { lat: 37.78, lng: -122.43 },
      { lat: 37.7805, lng: -122.43 },
    ];
    const edges: GraphEdge[] = [
      { id: 0, from: 0, to: 1, name: "On Facility", roadClass: "residential", tier: "none", lengthMeters: 55, maxspeed: null },
      { id: 1, from: 2, to: 3, name: "Far Away", roadClass: "residential", tier: "none", lengthMeters: 55, maxspeed: null },
    ];
    const lanes: BikeLaneSegment[] = [
      {
        id: "sfmta-1",
        name: "Protected Thing",
        tier: "fullyProtected",
        path: [
          { lat: 37.7698, lng: -122.42 },
          { lat: 37.7708, lng: -122.42 },
        ],
      },
    ];
    return { nodes, edges, lanes };
  }

  it("upgrades an edge sitting on a protected facility", () => {
    const { nodes, edges, lanes } = fixture();
    const stats = applyLaneTiers(edges, nodes, lanes);
    expect(edges[0].tier).toBe("fullyProtected");
    expect(stats.upgradedToProtected).toBe(1);
  });

  it("leaves edges with no nearby facility untouched", () => {
    const { nodes, edges, lanes } = fixture();
    applyLaneTiers(edges, nodes, lanes);
    // OSM's tag is kept where SFMTA has no coverage - the graph extends
    // past the surveyed network and includes paths SFMTA does not catalogue.
    expect(edges[1].tier).toBe("none");
  });

  it("does not match a facility further than the tolerance", () => {
    const { nodes, edges } = fixture();
    const farLane: BikeLaneSegment[] = [
      {
        id: "sfmta-far",
        name: "A block over",
        tier: "fullyProtected",
        // ~90m east of the edge: a different street, and matching it would
        // credit this edge with a lane it does not have.
        path: [
          { lat: 37.7698, lng: -122.419 },
          { lat: 37.7708, lng: -122.419 },
        ],
      },
    ];
    const stats = applyLaneTiers(edges, nodes, farLane);
    expect(stats.matched).toBe(0);
    expect(edges[0].tier).toBe("none");
  });

  it("takes the most protective facility when several are in range", () => {
    const { nodes, edges } = fixture();
    const both: BikeLaneSegment[] = [
      { id: "a", name: "painted", tier: "unprotected", path: [{ lat: 37.7698, lng: -122.42 }, { lat: 37.7708, lng: -122.42 }] },
      { id: "b", name: "protected", tier: "fullyProtected", path: [{ lat: 37.7698, lng: -122.4201 }, { lat: 37.7708, lng: -122.4201 }] },
    ];
    applyLaneTiers(edges, nodes, both);
    expect(edges[0].tier).toBe("fullyProtected");
  });

  it("can downgrade, not only upgrade", () => {
    // OSM optimism is as wrong as OSM omission; SFMTA wins either way.
    const { nodes, edges } = fixture();
    edges[0].tier = "fullyProtected";
    const painted: BikeLaneSegment[] = [
      { id: "a", name: "painted", tier: "unprotected", path: [{ lat: 37.7698, lng: -122.42 }, { lat: 37.7708, lng: -122.42 }] },
    ];
    const stats = applyLaneTiers(edges, nodes, painted);
    expect(edges[0].tier).toBe("unprotected");
    expect(stats.changed).toBe(1);
    expect(stats.upgradedToProtected).toBe(0);
  });
});

describe("the real graph after reconciliation", () => {
  const eng = getRoutingEngine();

  it("actually ran, and corrected a substantial share of tiers", () => {
    // Measured: 57,542 of 211,221 edges matched an SFMTA facility, 32,128
    // tiers changed, 16,811 upgraded to protected. Floors well below those
    // so ordinary data refreshes do not trip the test.
    expect(eng.laneMatch.matched).toBeGreaterThan(30_000);
    expect(eng.laneMatch.changed).toBeGreaterThan(10_000);
    expect(eng.laneMatch.upgradedToProtected).toBeGreaterThan(5_000);
  });

  it("fixes the implausible shortage of semi-protected lanes", () => {
    // Inferring buffered lanes from OSM tags yielded 89 semi-protected
    // edges city-wide against SFMTA's 274 buffered facilities - a tell
    // that the tag heuristic was far too narrow.
    const semi = eng.graph.edges.filter((e) => e.tier === "semiProtected").length;
    expect(semi).toBeGreaterThan(1000);
  });

  it("agrees with SFMTA on tiers wherever SFMTA has coverage", () => {
    // The point of the whole exercise: after reconciliation, a second pass
    // should find nothing left to change.
    const copy = eng.graph.edges.map((e) => ({ ...e }));
    const second = applyLaneTiers(copy, eng.graph.nodes, REAL_SF_BIKE_LANES);
    expect(second.changed).toBe(0);
  });
});

describe("strict lane matching (regions surveyed after SF)", () => {
  // A protected lane running due east, and edges at the same spot.
  const lane = (over: Partial<BikeLaneSegment> = {}): BikeLaneSegment => ({
    id: "l",
    name: "Lane",
    tier: "fullyProtected",
    path: [
      { lat: 37.3, lng: -121.9 },
      { lat: 37.3, lng: -121.89 },
    ],
    ...over,
  });
  const nodes = [
    { lat: 37.3, lng: -121.896 },
    { lat: 37.3, lng: -121.895 }, // ~88m east, along the lane
    { lat: 37.3008, lng: -121.8955 }, // ~88m north of the lane: a side street
    { lat: 37.2992, lng: -121.8955 },
  ];
  const edge = (from: number, to: number, roadClass: GraphEdge["roadClass"] = "residential", tier: GraphEdge["tier"] = "none"): GraphEdge => ({
    id: 0,
    from,
    to,
    name: null,
    roadClass,
    tier,
    lengthMeters: 88,
    maxspeed: null,
  });

  it("marks the street the lane runs along", () => {
    const e = edge(0, 1);
    applyLaneTiers([e], nodes, [lane()], { strict: true });
    expect(e.tier).toBe("fullyProtected");
  });

  it("does not mark a side street crossing the lane", () => {
    const e = edge(2, 3);
    applyLaneTiers([e], nodes, [lane()], { strict: true });
    expect(e.tier).toBe("none");
    // The loose reading SF keeps does mark it: this is the case that differs.
    const short = lane({
      path: [
        { lat: 37.3, lng: -121.8957 },
        { lat: 37.3, lng: -121.8953 },
      ],
    });
    const strictEdge = edge(2, 3);
    applyLaneTiers([strictEdge], nodes, [short], { strict: true });
    expect(strictEdge.tier).toBe("none");
    const loose = edge(2, 3);
    applyLaneTiers([loose], nodes, [short]);
    expect(loose.tier).toBe("fullyProtected");
  });

  it("does not make a road beside an off-street path car-free", () => {
    const road = edge(0, 1);
    applyLaneTiers([road], nodes, [lane({ offStreet: true })], { strict: true });
    expect(road.tier).toBe("none");
    const trail = edge(0, 1, "path");
    applyLaneTiers([trail], nodes, [lane({ offStreet: true })], { strict: true });
    expect(trail.tier).toBe("fullyProtected");
  });

  it("finds edges far from either end of a long straight record", () => {
    // ~440m from both vertices, with nothing in between: the case the
    // vertex-only index SF uses cannot see. Sabotage check: it stays "none" there.
    const e = edge(0, 1);
    applyLaneTiers([e], nodes, [lane()]);
    expect(e.tier).toBe("none");
    applyLaneTiers([e], nodes, [lane()], { strict: true });
    expect(e.tier).toBe("fullyProtected");
  });

  it("never downgrades a car-free cycleway to the painted lane beside it", () => {
    const e = edge(0, 1, "cycleway", "fullyProtected");
    applyLaneTiers([e], nodes, [lane({ tier: "unprotected" })], { strict: true });
    expect(e.tier).toBe("fullyProtected");
  });
});
