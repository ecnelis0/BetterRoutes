/**
 * Measures what the San José router does on real cross-town trips, the way
 * docs/EVIDENCE.md does for SF: Fastest against Safest + bike lanes.
 *
 * Run: npx tsx scripts/evalSanJoseRoutes.ts
 */
import { getRoutingEngine, planRoutes } from "../lib/routing/service";

const P = {
  "SAP Center": { lat: 37.3327, lng: -121.9012 },
  "San José State": { lat: 37.3352, lng: -121.8811 },
  Japantown: { lat: 37.3489, lng: -121.8949 },
  "Santana Row": { lat: 37.321, lng: -121.948 },
  "Willow Glen": { lat: 37.304, lng: -121.895 },
  "Alum Rock Park": { lat: 37.3975, lng: -121.8 },
  "Almaden Lake": { lat: 37.238, lng: -121.88 },
  "Evergreen Valley College": { lat: 37.3008, lng: -121.762 },
  "Alviso Marina": { lat: 37.428, lng: -121.979 },
  "SJC Airport": { lat: 37.3639, lng: -121.9289 },
};
type Name = keyof typeof P;
const TRIPS: [Name, Name][] = [
  ["Alviso Marina", "SAP Center"],
  ["Santana Row", "San José State"],
  ["Willow Glen", "Japantown"],
  ["Almaden Lake", "SAP Center"],
  ["Evergreen Valley College", "San José State"],
  ["Alum Rock Park", "SJC Airport"],
  ["Japantown", "Almaden Lake"],
  ["SJC Airport", "Santana Row"],
];

let t = Date.now();
const eng = getRoutingEngine("sanjose");
console.log(`engine: ${Date.now() - t}ms, ${eng.graph.edges.length} edges, model ${eng.modelSource} ${eng.model.version}`);
console.log(`signals matched ${eng.signalsMatched}, hotspots ${eng.hotspots.length}, crashes ${eng.crashCount}`);
const pct = (q: number) => {
  const sorted = Float32Array.from(eng.scores).sort();
  return sorted[Math.floor(q * (sorted.length - 1))].toFixed(0);
};
console.log(`scores p1 ${pct(0.01)} p50 ${pct(0.5)} p99 ${pct(0.99)} max ${pct(1)}`);
const over = (s: number) => (eng.scores.filter((x) => x >= s).length / eng.scores.length) * 100;
console.log(`edges at/over hard-avoid: 80 -> ${over(80).toFixed(2)}%, 88 -> ${over(88).toFixed(2)}%`);

const sum = { fast: 0, safe: 0, fastMi: 0, safeMi: 0, ms: 0 };
for (const [a, b] of TRIPS) {
  t = Date.now();
  const routes = planRoutes(P[a], P[b]);
  const ms = Date.now() - t;
  const f = routes.find((r) => r.profile === "fastest")!;
  const s = routes.find((r) => r.profile === "safest")!;
  const mi = (m: number) => (m / 1609.34).toFixed(1);
  console.log(
    `${a} -> ${b}: ${ms}ms | fastest ${mi(f.distanceMeters)}mi ${(f.protectedLaneFraction * 100).toFixed(0)}% protected | ` +
      `safest+lanes ${mi(s.distanceMeters)}mi ${(s.protectedLaneFraction * 100).toFixed(0)}% protected${s.label.includes("best effort") ? " (best effort)" : ""}`
  );
  sum.fast += f.protectedLaneFraction;
  sum.safe += s.protectedLaneFraction;
  sum.fastMi += f.distanceMeters;
  sum.safeMi += s.distanceMeters;
  sum.ms += ms;
}
const n = TRIPS.length;
console.log(
  `AVERAGE protected: fastest ${((sum.fast / n) * 100).toFixed(1)}% -> safest+lanes ${((sum.safe / n) * 100).toFixed(1)}%; ` +
    `distance +${((sum.safeMi / sum.fastMi - 1) * 100).toFixed(0)}%; ${Math.round(sum.ms / n)}ms per trip`
);
console.log(`rss ${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);
