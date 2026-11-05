// One-time data-generation script: pulls the full *bike-routable* street
// network for San Francisco from OpenStreetMap (Overpass API) and writes a
// node/edge graph that `lib/routing/` can actually route on.
//
// Why this exists alongside `fetchSfRoads.mjs`: that script produces
// *display* geometry - major named roads, merged into long smooth chains
// for rendering, with residential streets deliberately excluded to keep the
// map readable. Those chains are useless for routing: merging ways destroys
// the intersection nodes, and a bike router without residential streets is
// a bike router that can't leave the arterials. This script keeps the
// opposite trade-off - every routable way, split at every shared node, with
// OSM node ids preserved so edges actually connect into a graph.
//
// Scope: ways bikes may legally and plausibly ride. Motorways/trunks are
// excluded outright (bikes are banned, and routing onto one is the exact
// failure this whole app exists to prevent); they still matter as a
// *proximity* risk input, which is what `fetchSfRoads.mjs` already covers.
//
// Re-run manually: `node scripts/fetchSfBikeGraph.mjs [--region=sanjose]`
// Output: lib/data/sfBikeGraph.json, or lib/data/<region>/bikeGraph.json

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { dataPath, regionArg } from "./regionConfig.mjs";

const REGION = regionArg();
const BOUNDS = REGION.bounds;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Way classes a bicycle may ride. Ordered roughly best-to-worst for cycling;
// the value is the `roadClass` feature the safety model consumes, NOT a
// score - scoring lives in lib/scoring, so retraining never means editing
// this file.
const ROUTABLE_HIGHWAY = {
  cycleway: "cycleway",
  living_street: "livingStreet",
  residential: "residential",
  unclassified: "residential",
  tertiary: "tertiary",
  tertiary_link: "tertiary",
  secondary: "secondary",
  secondary_link: "secondary",
  primary: "primary",
  primary_link: "primary",
  path: "path",
  footway: "path",
  pedestrian: "path",
  track: "path",
  service: "service",
};

// Bikes are banned on these no matter what else the tags say.
const BANNED_HIGHWAY = new Set(["motorway", "motorway_link", "trunk", "trunk_link"]);

// Roads that are a *hazard to ride near* even though (or precisely because)
// you cannot ride on them. These feed the `freewayProximity` and
// `arterialProximity` features, not the routable graph.
//
// Previously this risk came from seven hand-drawn mock shapes
// (MOCK_HIGHWAY_SEGMENTS), which meant the overwhelming majority of San
// Francisco's real arterials - Bayshore, James Lick, Junipero Serra,
// Octavia, Bryant, 19th Ave and ~170 others - contributed exactly zero
// highway-exposure risk. A route could hug the Central Freeway for a mile
// and the model would not notice.
const EXPOSURE_CLASS = {
  motorway: "freeway",
  motorway_link: "freeway",
  trunk: "freeway",
  trunk_link: "freeway",
  primary: "arterial",
  primary_link: "arterial",
  secondary: "arterial",
  secondary_link: "arterial",
};

// Typical speeds by class, used to scale exposure risk where OSM has no
// maxspeed tag. Rough, and only a feature input - the model decides how
// much speed actually matters.
const DEFAULT_SPEED_MPH = { freeway: 60, arterial: 35 };

function overpassQuery() {
  const bbox = `${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`;
  return `
[out:json][timeout:300][maxsize:1073741824];
(
  way["highway"~"^(${[...Object.keys(ROUTABLE_HIGHWAY), ...BANNED_HIGHWAY].join("|")})$"](${bbox});
);
out body geom;
`.trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass() {
  const body = new URLSearchParams({ data: overpassQuery() }).toString();
  let lastErr;
  // Overpass answers 429 when its slots are busy and 504 when a query times
  // out server-side; both are routinely transient, so back off and retry
  // rather than failing the whole run. A missing User-Agent earns a 406.
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        process.stdout.write(`Querying ${endpoint} (attempt ${attempt + 1}) ...\n`);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "BetterRoutes-bike-graph-fetch/1.0 (one-time dev script)",
            Accept: "application/json",
          },
          body,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json.elements?.length) throw new Error("no elements returned");
        return json.elements;
      } catch (err) {
        lastErr = err;
        process.stdout.write(`  failed: ${err.message}\n`);
      }
    }
    const waitMs = 20_000 * (attempt + 1);
    process.stdout.write(`  all endpoints failed; waiting ${waitMs / 1000}s before retry\n`);
    await sleep(waitMs);
  }
  throw new Error(`All Overpass endpoints failed. Last: ${lastErr?.message}`);
}

function haversineMeters(a, b) {
  const R = 6_371_000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Reads OSM cycling-infrastructure tags into the same four-tier vocabulary
 * the rest of the app already speaks (`BikeLaneTier` in lib/types.ts).
 * This is a *feature extractor*, not a judgement about how safe each tier
 * is - that judgement is the model's job and lives in lib/scoring.
 */
function bikeLaneTierFromTags(tags) {
  const t = (k) => (tags[k] ?? "").toLowerCase();

  if (t("highway") === "cycleway") return "fullyProtected";
  // A designated shared path is a car-free bike route. Outside a city's own
  // survey this tag is all that says so: Los Gatos Creek Trail through
  // Campbell is highway=path, not highway=cycleway.
  if (t("highway") === "path" && t("bicycle") === "designated") return "fullyProtected";
  // Explicit physical separation.
  const sep = [t("cycleway"), t("cycleway:both"), t("cycleway:left"), t("cycleway:right")];
  if (sep.some((v) => v === "track")) return "fullyProtected";
  if (t("cycleway:both:separation") || t("cycleway:separation")) return "fullyProtected";
  for (const side of ["left", "right"]) {
    const v = t(`cycleway:${side}:separation`);
    if (v && v !== "no") return "fullyProtected";
  }
  if (sep.some((v) => v === "lane" || v === "opposite_lane")) {
    // A buffered lane is meaningfully better than bare paint.
    const buffered =
      t("cycleway:both:buffer") ||
      t("cycleway:buffer") ||
      t("cycleway:lane") === "exclusive" ||
      ["left", "right"].some((side) => {
        const v = t(`cycleway:${side}:buffer`);
        return v && v !== "no";
      });
    return buffered ? "semiProtected" : "unprotected";
  }
  if (sep.some((v) => v === "shared_lane" || v === "share_busway")) return "unprotected";
  return "none";
}

// "Avoid all forms of freeway": county expressways are often tagged as ordinary
// primary roads (18 miles of Almaden Expressway were routable, and Fastest used
// it), so the name is what gives them away. Old Bayshore Highway and the like are
// ordinary streets named after what they replaced, so "highway" is not matched.
const FREEWAY_NAME = /\b(expressway|expwy|expy|freeway|fwy)\b/i;
// Sidewalk-side paths and cycleways near these keep their own class and stay usable.
const CAR_FREE_HIGHWAY = new Set(["cycleway", "path", "footway", "pedestrian", "track"]);

/** A road a rider must never be sent along, in regions that take the strict reading. */
function isFreewayLike(tags) {
  return !CAR_FREE_HIGHWAY.has((tags.highway ?? "").toLowerCase()) && FREEWAY_NAME.test(tags.name ?? "");
}

const MINOR_SERVICE = new Set(["parking_aisle", "driveway", "drive-through", "emergency_access"]);

function isPrivateOrParking(tags) {
  if ((tags.highway ?? "") === "service" && MINOR_SERVICE.has((tags.service ?? "").toLowerCase())) return true;
  const access = (tags.access ?? "").toLowerCase();
  const bicycle = (tags.bicycle ?? "").toLowerCase();
  return (access === "private" || access === "no") && bicycle !== "yes" && bicycle !== "designated";
}

function isOneway(tags) {
  const ow = (tags.oneway ?? "").toLowerCase();
  // `oneway:bicycle=no` is the common tag for "cars one way, bikes both" -
  // contraflow lanes are everywhere in SF and ignoring them would make the
  // router detour around perfectly legal blocks.
  if ((tags["oneway:bicycle"] ?? "").toLowerCase() === "no") return false;
  return ow === "yes" || ow === "true" || ow === "1";
}

// Overpass is a free, shared, donation-funded service. Re-running this
// script while iterating on the *encoding* below should not mean re-asking
// them for the same 40MB of ways, so the raw response is cached off to one
// side and reused unless `--refresh` is passed.
const RAW_CACHE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  ".cache",
  `${REGION.id}-overpass-raw.json`
);

const ALONG_FREEWAY_METERS = 50;
const ALONG_FREEWAY_MAX_ANGLE = 25;
const MIN_EDGE_FOR_ANGLE_METERS = 10;

/**
 * Edges running beside a freeway, not merely near one: within 50m of its centre
 * line and pointing the same way. An overpass or underpass crosses at an angle
 * and is not caught, which matters because crossing is the only way across town.
 */
function edgesAlongFreeways(edges, nodes, exposureRoads) {
  const CELL = 0.001; // ~100m, comfortably wider than the 50m search
  const key = (lat, lng) => `${Math.floor(lat / CELL)},${Math.floor(lng / CELL)}`;
  const grid = new Map();
  for (const road of exposureRoads) {
    if (road.type !== "freeway") continue;
    for (let i = 0; i < road.path.length - 1; i++) {
      const a = road.path[i];
      const b = road.path[i + 1];
      const steps = Math.max(1, Math.ceil(haversineMeters(a, b) / 50));
      for (let k = 0; k <= steps; k++) {
        const c = key(a.lat + ((b.lat - a.lat) * k) / steps, a.lng + ((b.lng - a.lng) * k) / steps);
        const list = grid.get(c);
        if (!list) grid.set(c, [[a, b]]);
        else if (list[list.length - 1][0] !== a) list.push([a, b]);
      }
    }
  }
  const cos = Math.cos((((BOUNDS.north + BOUNDS.south) / 2) * Math.PI) / 180);
  const M = 111_320;
  const out = [];
  edges.forEach((e, index) => {
    if (e.lengthMeters < MIN_EDGE_FOR_ANGLE_METERS) return;
    const p = nodes.get(e.from);
    const q = nodes.get(e.to);
    const mid = { lat: (p.lat + q.lat) / 2, lng: (p.lng + q.lng) / 2 };
    const r0 = Math.floor(mid.lat / CELL);
    const c0 = Math.floor(mid.lng / CELL);
    const edgeAngle = Math.atan2(q.lat - p.lat, (q.lng - p.lng) * cos);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (const [a, b] of grid.get(`${r0 + dr},${c0 + dc}`) ?? []) {
          // Distance from the midpoint to the segment, in a local flat frame.
          const ax = (a.lng - mid.lng) * M * cos;
          const ay = (a.lat - mid.lat) * M;
          const bx = (b.lng - mid.lng) * M * cos;
          const by = (b.lat - mid.lat) * M;
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
          if (Math.hypot(ax + dx * t, ay + dy * t) > ALONG_FREEWAY_METERS) continue;
          let diff = (Math.abs(edgeAngle - Math.atan2(dy, dx)) * 180) / Math.PI;
          diff %= 180;
          if (Math.min(diff, 180 - diff) <= ALONG_FREEWAY_MAX_ANGLE) {
            out.push(index);
            return;
          }
        }
      }
    }
  });
  return out;
}

async function loadElements() {
  const refresh = process.argv.includes("--refresh");
  if (!refresh && existsSync(RAW_CACHE)) {
    process.stdout.write(`Reusing cached Overpass response (${RAW_CACHE}).\n`);
    process.stdout.write(`Pass --refresh to re-query.\n`);
    return JSON.parse(readFileSync(RAW_CACHE, "utf8"));
  }
  const elements = await fetchOverpass();
  mkdirSync(path.dirname(RAW_CACHE), { recursive: true });
  writeFileSync(RAW_CACHE, JSON.stringify(elements));
  return elements;
}

function main() {
  return loadElements().then((elements) => {
    const nodes = new Map(); // osm node id -> {id, lat, lng}
    const edges = [];
    let skippedBanned = 0;
    let skippedUnroutable = 0;

    const exposureRoads = [];
    // Nodes on a raised deck or in a tunnel, and nodes also on ordinary road:
    // a node only on the former is off the ground, so terrain data is wrong there.
    const onSpan = new Set();
    const onGround = new Set();

    for (const el of elements) {
      if (el.type !== "way" || !el.geometry || !el.nodes) continue;
      const tags = el.tags ?? {};
      const hw = (tags.highway ?? "").toLowerCase();

      // Record proximity hazards before the routability filters below drop
      // them - freeways in particular are *excluded from the graph* yet are
      // the single biggest exposure risk, so they must be captured here or
      // they are lost entirely.
      const strictFreeway = REGION.id !== "sf" && isFreewayLike(tags);
      const exposure = strictFreeway ? "freeway" : EXPOSURE_CLASS[hw];
      if (exposure) {
        const mph =
          parseInt((tags.maxspeed ?? "").replace(/[^0-9]/g, ""), 10) ||
          DEFAULT_SPEED_MPH[exposure];
        exposureRoads.push({
          id: `osm-${el.id}`,
          name: tags.name ?? (exposure === "freeway" ? "Unnamed freeway" : "Unnamed arterial"),
          type: exposure,
          typicalSpeedMph: mph,
          path: el.geometry.map((g) => ({
            lat: Math.round(g.lat * 1e6) / 1e6,
            lng: Math.round(g.lon * 1e6) / 1e6,
          })),
        });
      }

      if (BANNED_HIGHWAY.has(hw) || strictFreeway) {
        skippedBanned++;
        continue;
      }
      const roadClass = ROUTABLE_HIGHWAY[hw];
      if (!roadClass) {
        skippedUnroutable++;
        continue;
      }
      // Respect explicit bike bans on otherwise-routable ways.
      if ((tags.bicycle ?? "").toLowerCase() === "no") {
        skippedUnroutable++;
        continue;
      }
      // Footways/pedestrian areas only count if bikes are actually allowed.
      if ((hw === "footway" || hw === "pedestrian") && (tags.bicycle ?? "").toLowerCase() !== "yes") {
        skippedUnroutable++;
        continue;
      }

      // Suburban Bay Area streets are lined with parking lots: unfiltered,
      // parking aisles and driveways were 43% of San Jose's segments, tripling
      // the graph for roads no bike route should use. SF's graph and its
      // trained scores stay as they were built, so only newer regions drop them.
      if (REGION.id !== "sf" && isPrivateOrParking(tags)) {
        skippedUnroutable++;
        continue;
      }

      const tier = bikeLaneTierFromTags(tags);
      const oneway = isOneway(tags);
      const name = tags.name ?? null;
      const maxspeed = parseInt((tags.maxspeed ?? "").replace(/[^0-9]/g, ""), 10) || null;

      const isSpan =
        (tags.bridge && tags.bridge !== "no") || (tags.tunnel && tags.tunnel !== "no") || tags.covered === "yes";
      for (const id of el.nodes) (isSpan ? onSpan : onGround).add(id);

      // Split the way at every OSM node: those shared nodes ARE the
      // intersections, and keeping them is the whole point of this file.
      for (let i = 0; i < el.nodes.length - 1; i++) {
        const aId = el.nodes[i];
        const bId = el.nodes[i + 1];
        const aGeom = el.geometry[i];
        const bGeom = el.geometry[i + 1];
        if (!aGeom || !bGeom) continue;

        if (!nodes.has(aId)) nodes.set(aId, { id: aId, lat: aGeom.lat, lng: aGeom.lon });
        if (!nodes.has(bId)) nodes.set(bId, { id: bId, lat: bGeom.lat, lng: bGeom.lon });

        const length = haversineMeters(
          { lat: aGeom.lat, lng: aGeom.lon },
          { lat: bGeom.lat, lng: bGeom.lon }
        );
        if (length <= 0) continue;

        edges.push({
          from: aId,
          to: bId,
          wayId: el.id,
          name,
          roadClass,
          tier,
          oneway,
          maxspeed,
          lengthMeters: Math.round(length * 10) / 10,
        });
      }
    }

    const alongFreeway = REGION.id === "sf" ? [] : edgesAlongFreeways(edges, nodes, exposureRoads);
    process.stdout.write(`Edges running alongside a freeway: ${alongFreeway.length}\n`);

    // Drop nodes no surviving edge references (cheap, keeps the file honest).
    const used = new Set();
    for (const e of edges) {
      used.add(e.from);
      used.add(e.to);
    }
    const nodeList = [...nodes.values()].filter((n) => used.has(n.id));

    const outPath = dataPath(REGION.id, "graph");
    mkdirSync(path.dirname(outPath), { recursive: true });

    // Compact columnar encoding. The obvious `[{from, to, roadClass, ...}]`
    // shape repeats ~120 bytes of JSON *key names* on every one of 128k
    // edges, which costs ~26MB on disk and a slow parse on every cold
    // start. Columnar arrays of small ints cut that by roughly 5x, and
    // `lib/routing/graph.ts` decodes it back into objects once at load.
    // Node ids are re-indexed to dense 0..n-1 integers (OSM ids are 10-digit
    // numbers); coordinates are fixed to 6dp, which is ~0.1m - far finer
    // than the geometry's own accuracy.
    const nodeIndex = new Map();
    nodeList.forEach((n, i) => nodeIndex.set(n.id, i));

    const roadClasses = [...new Set(edges.map((e) => e.roadClass))];
    const tiers = [...new Set(edges.map((e) => e.tier))];
    const names = [...new Set(edges.map((e) => e.name).filter(Boolean))];
    const nameIndex = new Map(names.map((n, i) => [n, i]));
    const r6 = (x) => Math.round(x * 1e6) / 1e6;

    const payload = {
      format: "columnar-v1",
      generatedAt: new Date().toISOString(),
      source: "OpenStreetMap contributors (ODbL), via Overpass API",
      bounds: BOUNDS,
      // Lookup tables for the small-int columns below.
      roadClasses,
      tiers,
      names,
      nodeCount: nodeList.length,
      edgeCount: edges.length,
      lat: nodeList.map((n) => r6(n.lat)),
      lng: nodeList.map((n) => r6(n.lng)),
      from: edges.map((e) => nodeIndex.get(e.from)),
      to: edges.map((e) => nodeIndex.get(e.to)),
      roadClass: edges.map((e) => roadClasses.indexOf(e.roadClass)),
      tier: edges.map((e) => tiers.indexOf(e.tier)),
      // -1 = unnamed, so the column stays a plain int array.
      name: edges.map((e) => (e.name == null ? -1 : nameIndex.get(e.name))),
      oneway: edges.map((e) => (e.oneway ? 1 : 0)),
      maxspeed: edges.map((e) => e.maxspeed ?? 0),
      lengthMeters: edges.map((e) => Math.round(e.lengthMeters * 10) / 10),
      // Edge indexes the router charges heavily for: see `edgesAlongFreeways`.
      alongFreeway,
      // Read by fetchSfElevation.mjs. Absent from SF's graph, which predates it.
      spanNodes: nodeList.flatMap((n, i) => (onSpan.has(n.id) && !onGround.has(n.id) ? [i] : [])),
    };
    writeFileSync(outPath, JSON.stringify(payload));

    const hwPath = dataPath(REGION.id, "highways");
    writeFileSync(
      hwPath,
      JSON.stringify({
        generatedAt: payload.generatedAt,
        source: payload.source,
        segments: exposureRoads,
      })
    );
    const expCounts = {};
    for (const r of exposureRoads) expCounts[r.type] = (expCounts[r.type] ?? 0) + 1;
    process.stdout.write(
      `Wrote ${hwPath}\n  exposure roads: ${JSON.stringify(expCounts)}\n`
    );

    const tierCounts = {};
    for (const e of edges) tierCounts[e.tier] = (tierCounts[e.tier] ?? 0) + 1;
    const classCounts = {};
    for (const e of edges) classCounts[e.roadClass] = (classCounts[e.roadClass] ?? 0) + 1;

    process.stdout.write(
      `\nWrote ${outPath}\n` +
        `  nodes: ${nodeList.length}\n` +
        `  edges: ${edges.length}\n` +
        `  skipped (bikes banned): ${skippedBanned}\n` +
        `  skipped (not routable): ${skippedUnroutable}\n` +
        `  by tier:  ${JSON.stringify(tierCounts)}\n` +
        `  by class: ${JSON.stringify(classCounts)}\n`
    );
  });
}

main().catch((err) => {
  process.stderr.write(`\nFailed: ${err.message}\n`);
  process.exit(1);
});
