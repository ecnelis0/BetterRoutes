import type { LatLng } from "../types";
import { cumulativeDistances } from "./traffic";

/**
 * The route's elevation profile as a shape in the 3D tour: a wall standing on
 * the route, taller where the road is higher and coloured by how steep it is.
 *
 * A flat 2D chart asks a rider to map distance back onto the streets; this
 * draws the climb on the street it happens on. Pure numbers, no three.js, so
 * the shape can be tested without a GPU - see `elevationLayer.ts` for drawing.
 */

export const ELEVATION_LAYER_ID = "elevation-ribbon";

export interface RibbonPoint extends LatLng {
  /** Ground elevation, metres. */
  elevation: number;
  /** Distance along the route, metres. */
  along: number;
  /** Grade over the surrounding road in the direction of travel, percent. */
  gradePercent: number;
  /** Height of the wall above the ground here, metres. */
  wallMeters: number;
  /** Wall colour: 0-1 RGB. */
  color: [number, number, number];
}

export interface RibbonExtreme extends LatLng {
  elevation: number;
  along: number;
}

export interface ElevationRibbon {
  points: RibbonPoint[];
  highest: RibbonExtreme;
  lowest: RibbonExtreme;
  totalMeters: number;
}

/** Height of the wall at the route's lowest point: enough to see from the air. */
const WALL_BASE_METERS = 20;
/** The route's whole elevation range is drawn at most this tall... */
const WALL_RANGE_METERS = 100;
/**
 * ...and never magnified more than this. Without the cap a pancake-flat ride
 * across downtown San José, a few metres of DEM noise end to end, would be
 * stretched to the same dramatic mountain as a ride over a real hill.
 */
const MAX_VERTICAL_SCALE = 4;
/** Grade is measured over this much road each way, so a DEM blip is not a wall. */
const GRADE_WINDOW_METERS = 25;

// Same reading as the tour's climb highlight: 6% is where a hill starts to bite.
const GRADE_STOPS: { grade: number; color: [number, number, number] }[] = [
  { grade: 0, color: [0.13, 0.77, 0.37] }, // flat: green
  { grade: 3, color: [0.52, 0.8, 0.09] },
  { grade: 6, color: [0.96, 0.62, 0.04] }, // climb: amber
  { grade: 10, color: [0.94, 0.27, 0.27] }, // steep: red
  { grade: 15, color: [0.66, 0.11, 0.66] }, // wall: purple
];

export function gradeColor(gradePercent: number): [number, number, number] {
  const g = Math.abs(gradePercent);
  for (let i = 1; i < GRADE_STOPS.length; i++) {
    const a = GRADE_STOPS[i - 1];
    const b = GRADE_STOPS[i];
    if (g <= b.grade) {
      const t = (g - a.grade) / (b.grade - a.grade);
      return [0, 1, 2].map((k) => a.color[k] + (b.color[k] - a.color[k]) * t) as [number, number, number];
    }
  }
  return GRADE_STOPS[GRADE_STOPS.length - 1].color;
}

/** Null when there is nothing to draw: no elevations, or they do not match the path. */
export function buildElevationRibbon(path: LatLng[], elevations: number[] | undefined): ElevationRibbon | null {
  if (!elevations || path.length < 2 || elevations.length !== path.length) return null;
  const cum = cumulativeDistances(path);
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const range = max - min;
  const scale = range > 0 ? Math.min(MAX_VERTICAL_SCALE, WALL_RANGE_METERS / range) : 0;

  let lo = 0;
  let hi = 0;
  const points: RibbonPoint[] = path.map((p, i) => {
    while (cum[i] - cum[lo] > GRADE_WINDOW_METERS) lo++;
    hi = Math.max(hi, i);
    while (hi < path.length - 1 && cum[hi] - cum[i] < GRADE_WINDOW_METERS) hi++;
    const run = cum[hi] - cum[lo];
    const gradePercent = run > 0 ? ((elevations[hi] - elevations[lo]) / run) * 100 : 0;
    return {
      lat: p.lat,
      lng: p.lng,
      elevation: elevations[i],
      along: cum[i],
      gradePercent,
      wallMeters: WALL_BASE_METERS + (elevations[i] - min) * scale,
      color: gradeColor(gradePercent),
    };
  });

  const extreme = (i: number): RibbonExtreme => ({
    lat: path[i].lat,
    lng: path[i].lng,
    elevation: elevations[i],
    along: cum[i],
  });
  return {
    points,
    highest: extreme(elevations.indexOf(max)),
    lowest: extreme(elevations.indexOf(min)),
    totalMeters: cum[cum.length - 1],
  };
}

/** The point at a distance along the ribbon, interpolated between vertices. */
export function ribbonAt(points: RibbonPoint[], along: number): RibbonPoint {
  if (along <= points[0].along) return points[0];
  let lo = 0;
  let hi = points.length - 1;
  if (along >= points[hi].along) return points[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].along <= along) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const t = b.along > a.along ? (along - a.along) / (b.along - a.along) : 0;
  return {
    ...a,
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    elevation: a.elevation + (b.elevation - a.elevation) * t,
    along,
    wallMeters: a.wallMeters + (b.wallMeters - a.wallMeters) * t,
  };
}
