import type { LatLng } from "../types";
import raw from "./regions.json";

/**
 * The areas the app can route in, one street graph each.
 *
 * Client-safe: names and boxes only. The heavy per-region data is loaded on
 * the server by `lib/routing/regionData.ts`. `scripts/regionConfig.mjs`
 * reads the same JSON, so a region's graph is always fetched for exactly the
 * box the app believes it covers (asserted in regions.test.ts).
 *
 * `safetyData` says whether crash history and flagged neighbourhoods have
 * been loaded. Where they have not, the router still prefers protected lanes
 * and calm streets but has nothing to say about danger hotspots, and the UI
 * must not imply otherwise.
 */
export type RegionId = keyof typeof raw;

export interface Region {
  id: RegionId;
  name: string;
  label: string;
  center: LatLng;
  bounds: { north: number; south: number; east: number; west: number };
  safetyData: boolean;
  /** Interests with nothing to find here: no point offering beaches in San José. */
  hiddenInterests?: string[];
}

export const REGION_IDS = Object.keys(raw) as RegionId[];

export const REGIONS = Object.fromEntries(
  REGION_IDS.map((id) => [id, { id, ...raw[id] }])
) as Record<RegionId, Region>;

export const DEFAULT_REGION: RegionId = "sf";

export function isRegionId(v: unknown): v is RegionId {
  return typeof v === "string" && REGION_IDS.includes(v as RegionId);
}

export function regionAt(p: LatLng): RegionId | null {
  for (const id of REGION_IDS) {
    const b = REGIONS[id].bounds;
    if (p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east) return id;
  }
  return null;
}
