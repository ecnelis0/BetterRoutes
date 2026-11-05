import { readFileSync } from "node:fs";
import path from "node:path";
import type { BikeLaneSegment, CrashRecord, HighwaySegment } from "../types";
import type { RegionId } from "../data/regions";
import { REAL_SF_BIKE_CRASHES } from "../dataSources/sfBikeCrashes";
import { REAL_SF_HIGHWAYS } from "../dataSources/sfHighways";
import { REAL_SF_BIKE_LANES } from "../dataSources/sfmtaBikeLanes";
import { SF_STEEP_AREAS, SF_STEEP_STREETS, type SteepArea, type SteepSeverity } from "../data/sfSteepAreas";
import { SF_DANGEROUS_NEIGHBORHOODS, type DangerousNeighborhood } from "../data/sfDangerousNeighborhoods";
import rawSfGraph from "../data/sfBikeGraph.json";
import rawSfElevation from "../data/sfNodeElevation.json";
import rawSfSignals from "../data/sfTrafficSignals.json";

/**
 * Everything the routing engine needs to know about one region.
 *
 * San Francisco's lists are hand-curated (flagged neighbourhoods, the
 * owner's steep streets) or come from city crash reports. San José has none
 * of those yet, deliberately: empty lists are what turn those rules off,
 * rather than a pile of `if (region === ...)` through the router.
 */
export interface RegionData {
  rawGraph: unknown;
  elevation: { format: string; graphGeneratedAt: string; nodeCount: number; elevDm: number[] };
  signals: { lat: number; lng: number }[];
  lanes: BikeLaneSegment[];
  highways: HighwaySegment[];
  crashes: CrashRecord[];
  neighborhoods: DangerousNeighborhood[];
  steepAreas: SteepArea[];
  steepStreets: Record<string, SteepSeverity>;
  artifactPath: string;
  /**
   * Stricter matching of a city's bike survey onto the graph: only streets
   * running along a facility, and off-street paths only onto path-like edges.
   * See `applyLaneTiers`.
   */
  strictLaneMatch: boolean;
}

// Read from disk rather than `import`ed: San José's graph is several times
// SF's, and a static import would compile it into every route handler that
// touches the router whether or not anyone rides there.
const SAN_JOSE_DIR = path.join(process.cwd(), "lib", "data", "sanjose");
const readJson = (file: string) => JSON.parse(readFileSync(path.join(SAN_JOSE_DIR, file), "utf8"));

export function loadRegionData(id: RegionId): RegionData {
  if (id === "sanjose") {
    return {
      rawGraph: readJson("bikeGraph.json"),
      elevation: readJson("nodeElevation.json"),
      signals: readJson("trafficSignals.json").signals,
      lanes: readJson("bikeLanes.json"),
      highways: readJson("highways.json").segments,
      crashes: [],
      neighborhoods: [],
      steepAreas: [],
      steepStreets: {},
      artifactPath: path.join(process.cwd(), "lib", "data", "model", "sanjose-safety-model.json"),
      strictLaneMatch: true,
    };
  }
  return {
    rawGraph: rawSfGraph,
    elevation: rawSfElevation,
    signals: (rawSfSignals as { signals: { lat: number; lng: number }[] }).signals,
    lanes: REAL_SF_BIKE_LANES,
    highways: REAL_SF_HIGHWAYS,
    crashes: REAL_SF_BIKE_CRASHES,
    neighborhoods: SF_DANGEROUS_NEIGHBORHOODS,
    steepAreas: SF_STEEP_AREAS,
    steepStreets: SF_STEEP_STREETS,
    artifactPath: path.join(process.cwd(), "lib", "data", "model", "safety-model.json"),
    strictLaneMatch: false,
  };
}
