import { DEFAULT_REGION, regionAt, REGION_IDS, REGIONS, type Region, type RegionId } from "./data/regions";

/**
 * Address search, backed by OpenStreetMap's Nominatim - shared by the
 * address boxes (/api/geocode) and the AI assistant ("go via Ocean Beach").
 *
 * Why not Google: this project's Google key has only the Maps JavaScript
 * API enabled (Places Autocomplete and Geocoding answer REQUEST_DENIED).
 * Nominatim needs no key and resolves against the same OpenStreetMap data
 * the routing graph is built from.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy: at most one request per second per application.
// A single-process in-memory gate - enough for one server, NOT for several.
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GeocodeHit {
  label: string;
  lat: number;
  lng: number;
}

/**
 * Restricted to exactly the area the routing graph covers: a confident
 * match outside it is worse than no match. (A narrower display box once cut
 * off Ocean Beach, which then resolved to an unrelated company downtown.)
 */
export async function geocode(q: string, limit = 6, region: RegionId = DEFAULT_REGION): Promise<GeocodeHit[]> {
  return searchBox(q, limit, REGIONS[region].bounds);
}

/** Nominatim's own ceiling on results per request. */
const WIDE_LIMIT = 40;

/**
 * Searches every area at once, the rider's selected one listed first. A rider
 * types an address, not a region: bounding the search to the selected area alone
 * meant a San José address typed with San Francisco selected came back empty,
 * and the box looked broken.
 *
 * One request over a box spanning every region, then matches outside a region
 * dropped: the box also holds cities with no graph yet. Searching area by area
 * instead took seconds, with Nominatim's one-a-second limit between each.
 */
export async function geocodeAnyRegion(q: string, preferred: RegionId = DEFAULT_REGION, limit = 6): Promise<GeocodeHit[]> {
  const boxes = REGION_IDS.map((id) => REGIONS[id].bounds);
  const wide = await searchBox(q, WIDE_LIMIT, {
    north: Math.max(...boxes.map((b) => b.north)),
    south: Math.min(...boxes.map((b) => b.south)),
    east: Math.max(...boxes.map((b) => b.east)),
    west: Math.min(...boxes.map((b) => b.west)),
  });
  const here = wide.filter((h) => regionAt(h) === preferred);
  // A full page with nothing from this area: "Starbucks" is 39 in San Francisco
  // before one in San José, so ask this area directly rather than miss it.
  if (here.length === 0 && wide.length === WIDE_LIMIT) {
    const direct = await geocode(q, limit, preferred);
    if (direct.length > 0) return direct;
  }
  const elsewhere = wide.filter((h) => {
    const r = regionAt(h);
    return r !== null && r !== preferred;
  });
  return [...here, ...elsewhere].slice(0, limit);
}

async function searchBox(q: string, limit: number, b: Region["bounds"]): Promise<GeocodeHit[]> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const url =
    `${NOMINATIM}?format=jsonv2&limit=${limit}&addressdetails=0` +
    `&viewbox=${b.west},${b.north},${b.east},${b.south}&bounded=1` +
    `&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      // Nominatim rejects requests without an identifying User-Agent.
      "User-Agent": "BetterRoutes/0.1 (safer bike routing; dev)",
      "Accept-Language": "en",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const raw = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return raw.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}
