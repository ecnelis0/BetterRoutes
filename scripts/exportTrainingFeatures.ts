/**
 * Exports one feature row per graph edge to CSV for model training.
 *
 * This script imports `extractFeatures` from `lib/scoring/features.ts` -
 * the exact same function the running app calls - rather than
 * reimplementing the feature maths in Python. That is deliberate and it is
 * the single most important property of this file.
 *
 * Train/serve skew (training on features computed one way, serving on
 * features computed subtly differently) is the classic silent ML failure:
 * offline metrics look great, production quality is mysteriously poor, and
 * nothing errors. Keeping exactly one implementation of the feature maths
 * makes that class of bug impossible rather than merely unlikely.
 *
 * Run: npm run ml:export-features [-- --region=sanjose]
 * Out: ml/data/edge_features.csv, or ml/data/<region>/edge_features.csv
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_REGION, isRegionId, type RegionId } from "../lib/data/regions";
import { loadRegionData } from "../lib/routing/regionData";
import { applyLaneTiers } from "../lib/scoring/laneMatch";
import {
  FEATURE_ORDER,
  FEATURE_SET_VERSION,
  buildFeatureContext,
  extractFeatures,
} from "../lib/scoring/features";
import { decodeGraph } from "../lib/routing/graph";
import { BASELINE_COEFFICIENTS, BASELINE_INTERCEPT } from "../lib/scoring/model";

const here = path.dirname(fileURLToPath(import.meta.url));

function main() {
  const arg = process.argv.find((a) => a.startsWith("--region="))?.slice("--region=".length);
  if (arg && !isRegionId(arg)) throw new Error(`Unknown region "${arg}".`);
  const region: RegionId = isRegionId(arg) ? arg : DEFAULT_REGION;
  const data = loadRegionData(region);
  const graph = decodeGraph(data.rawGraph as Parameters<typeof decodeGraph>[0]);
  // Identical correction to the one getRoutingEngine applies - otherwise
  // the model trains on OSM tiers and serves on SFMTA tiers, which is
  // train/serve skew of exactly the kind this pipeline is built to avoid.
  const laneMatch = applyLaneTiers(graph.edges, graph.nodes, data.lanes, { strict: data.strictLaneMatch });
  process.stdout.write(
    `City lane reconciliation: matched ${laneMatch.matched}, changed ${laneMatch.changed}, ` +
      `upgraded to protected ${laneMatch.upgradedToProtected}\n`
  );

  const ctx = buildFeatureContext(data.crashes, data.highways, graph.nodes, data.neighborhoods);

  // Identifying columns first, then the feature vector in FEATURE_ORDER.
  // `edge_id` is what a precomputed score table is keyed by, and
  // `graph_generated_at` is recorded in the artifact so a score table built
  // against a stale graph refuses to load (edge ids are positional).
  const header = [
    "edge_id",
    "from_node",
    "to_node",
    "street_name",
    "road_class",
    "lane_tier",
    "length_meters",
    "mid_lat",
    "mid_lng",
    ...FEATURE_ORDER,
  ];

  const rows: string[] = [header.join(",")];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  for (const edge of graph.edges) {
    const f = extractFeatures(edge, ctx);
    const a = graph.nodes[edge.from];
    const b = graph.nodes[edge.to];
    rows.push(
      [
        edge.id,
        edge.from,
        edge.to,
        esc(edge.name),
        edge.roadClass,
        edge.tier,
        edge.lengthMeters,
        ((a.lat + b.lat) / 2).toFixed(6),
        ((a.lng + b.lng) / 2).toFixed(6),
        ...FEATURE_ORDER.map((k) => {
          const v = f[k];
          return Number.isInteger(v) ? v : Number(v.toFixed(6));
        }),
      ].join(",")
    );
  }

  const outDir = path.join(here, "..", "ml", "data", ...(region === DEFAULT_REGION ? [] : [region]));
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "edge_features.csv");
  writeFileSync(outPath, rows.join("\n") + "\n");

  // Side-car metadata so train.py never has to guess, and so a retrain
  // against a regenerated graph is detectable.
  const metaPath = path.join(outDir, "feature_meta.json");
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        featureSetVersion: FEATURE_SET_VERSION,
        featureOrder: FEATURE_ORDER,
        // The app's own baseline, so train.py's --target=baseline cannot
        // drift from it (it previously kept a hand-copied duplicate).
        baselineCoefficients: BASELINE_COEFFICIENTS,
        baselineIntercept: BASELINE_INTERCEPT,
        edgeCount: graph.edges.length,
        graphGeneratedAt: graph.generatedAt,
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );

  process.stdout.write(
    `Wrote ${outPath}\n  ${graph.edges.length} edges x ${FEATURE_ORDER.length} features\n` +
      `Wrote ${metaPath}\n  feature set v${FEATURE_SET_VERSION}, graph ${graph.generatedAt}\n`
  );
}

main();
