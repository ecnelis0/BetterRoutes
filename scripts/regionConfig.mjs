// Which region a data script is working on (`--region=sanjose`, default SF)
// and where that region's generated files live. SF predates regions, so its
// files keep their original flat names; everything newer gets a folder.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const regions = JSON.parse(readFileSync(path.join(root, "lib", "data", "regions.json"), "utf8"));

export function regionArg(argv = process.argv) {
  const id = argv.find((a) => a.startsWith("--region="))?.slice("--region=".length) ?? "sf";
  if (!regions[id]) throw new Error(`Unknown region "${id}". Known: ${Object.keys(regions).join(", ")}`);
  return { id, ...regions[id] };
}

const SF_FILES = {
  graph: "sfBikeGraph.json",
  highways: "sfHighways.json",
  elevation: "sfNodeElevation.json",
  pois: "sfPois.json",
  lanes: "sfBikeLanes.json",
  signals: "sfTrafficSignals.json",
};

/** Absolute path of a generated data file: graph, highways, elevation, pois, lanes or signals. */
export function dataPath(regionId, kind) {
  const dir = path.join(root, "lib", "data");
  return regionId === "sf"
    ? path.join(dir, SF_FILES[kind])
    : path.join(dir, regionId, SF_FILES[kind].replace(/^sf(.)/, (_, c) => c.toLowerCase()));
}
