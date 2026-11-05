// One-time import of the City of San José's own surveyed bike network and
// traffic signals, from its open-data ArcGIS service. The San José
// counterpart of importSfmtaBikeLanes.mjs and importTrafficSignals.mjs, and
// written to the same JSON shapes, so nothing downstream knows the difference.
//
// Tier mapping, matching SF's so that "protected" means one thing everywhere:
//   - Class 1 (off-street path)              -> fullyProtected
//   - Class 4 (physically separated bikeway) -> fullyProtected
//   - Class 2 (Buffered)                     -> semiProtected
//   - Class 2 (Basic)                        -> unprotected
//   - Class 3 (sharrow, bike boulevard)      -> none: no lane space of its own
//
// Only built facilities count. Sending a rider to a "protected lane" that is
// still on a plan is the worst possible failure of this data, so the STATUS
// filter runs server-side and is asserted again on what comes back.
//
// Run: node scripts/importSanJoseData.mjs
// Out: lib/data/sanjose/bikeLanes.json, lib/data/sanjose/trafficSignals.json

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataPath } from "./regionConfig.mjs";

const SERVICE = "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer";
const BIKEWAYS_LAYER = 418;
const SIGNALS_LAYER = 506;
const PAGE = 1000;
const MAX_POINTS_PER_SEGMENT = 30;

async function queryAll(layer, params) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const qs = new URLSearchParams({
      outSR: "4326",
      f: "json",
      orderByFields: "OBJECTID",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      ...params,
    });
    const res = await fetch(`${SERVICE}/${layer}/query?${qs}`, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`Layer ${layer}: HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`Layer ${layer}: ${JSON.stringify(json.error)}`);
    out.push(...json.features);
    if (json.features.length < PAGE) return out;
  }
}

export function tierForClass(bikewayClass) {
  const c = (bikewayClass ?? "").toLowerCase();
  if (c.startsWith("class 1") || c.startsWith("class 4")) return "fullyProtected";
  if (c.startsWith("class 2") && c.includes("buffered")) return "semiProtected";
  if (c.startsWith("class 2")) return "unprotected";
  if (c.startsWith("class 3")) return "none";
  return null;
}

function thin(points) {
  if (points.length <= MAX_POINTS_PER_SEGMENT) return points;
  const step = (points.length - 1) / (MAX_POINTS_PER_SEGMENT - 1);
  return Array.from({ length: MAX_POINTS_PER_SEGMENT }, (_, i) => points[Math.round(i * step)]);
}

async function importBikeways() {
  const rows = await queryAll(BIKEWAYS_LAYER, {
    where: "STATUS = 'Existing'",
    outFields: "OBJECTID,STATUS,EXISTINGBIKEWAYCLASS,FULLSTREETNAME",
  });
  const lanes = [];
  const counts = {};
  let skipped = 0;
  for (const { attributes: a, geometry } of rows) {
    if (a.STATUS !== "Existing") throw new Error(`Unbuilt facility came back: ${a.OBJECTID} ${a.STATUS}`);
    const tier = tierForClass(a.EXISTINGBIKEWAYCLASS);
    if (!tier || !geometry?.paths?.length) {
      skipped++;
      continue;
    }
    geometry.paths.forEach((p, part) => {
      if (p.length < 2) return;
      lanes.push({
        id: `sj-${a.OBJECTID}${part ? `-${part}` : ""}`,
        name: a.FULLSTREETNAME || "Bike path",
        tier,
        ...((a.EXISTINGBIKEWAYCLASS ?? "").toLowerCase().startsWith("class 1") ? { offStreet: true } : {}),
        path: thin(p).map(([lng, lat]) => ({
          lat: Math.round(lat * 1e7) / 1e7,
          lng: Math.round(lng * 1e7) / 1e7,
        })),
      });
    });
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  const out = dataPath("sanjose", "lanes");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(lanes));
  console.log(`Wrote ${out}: ${lanes.length} segments ${JSON.stringify(counts)}, skipped ${skipped}`);
}

async function importSignals() {
  const rows = await queryAll(SIGNALS_LAYER, {
    where: "1=1",
    outFields: "OBJECTID,INTERSECTIONNAME1,INTERSECTIONNAME2,STATUS,DEACTIVATIONDATE,SHOPTYPE",
  });
  const statuses = {};
  const signals = [];
  for (const { attributes: a, geometry } of rows) {
    statuses[a.STATUS] = (statuses[a.STATUS] ?? 0) + 1;
    // "Future", "Cancelled" and "Deactivated" signals are in this layer too,
    // and none of them will stop a rider today.
    if (!(a.STATUS ?? "").startsWith("Existing") || !geometry) continue;
    signals.push({
      lat: Math.round(geometry.y * 1e6) / 1e6,
      lng: Math.round(geometry.x * 1e6) / 1e6,
      type: a.SHOPTYPE ?? "SIGNAL",
      streets: [a.INTERSECTIONNAME1, a.INTERSECTIONNAME2].filter(Boolean).join(" & "),
    });
  }
  const out = dataPath("sanjose", "signals");
  writeFileSync(
    out,
    JSON.stringify({
      source: "City of San José, City Owned Traffic Signals (open data)",
      importedAt: new Date().toISOString(),
      count: signals.length,
      signals,
    })
  );
  console.log(`Wrote ${out}: ${signals.length} of ${rows.length}; statuses ${JSON.stringify(statuses)}`);
}

await importBikeways();
await importSignals();
