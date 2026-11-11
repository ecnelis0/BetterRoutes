import { haversineMeters } from "../geo";
import { regionAt, REGIONS, type RegionId } from "../data/regions";
import type { LatLng } from "../types";
import { RIDE_IDEAS, type Difficulty, type RideIdea, type RideTag, type Surface } from "./rideIdeas";

/**
 * Picks rides from RIDE_IDEAS for what the rider likes. Pure and
 * deterministic: the assistant states the wishes, this decides the list,
 * so it can only ever suggest rides that were actually researched.
 */

export type Reach = "nearby" | "short-drive" | "day-trip" | "far";

/** Straight-line miles from home; road distance is roughly 1.3x. */
const REACH_MAX_MILES: Record<Reach, number> = { nearby: 8, "short-drive": 20, "day-trip": 40, far: Infinity };
const REACHES = Object.keys(REACH_MAX_MILES) as Reach[];
const DIFFICULTIES: Difficulty[] = ["easy", "moderate", "hard", "very-hard"];
const METERS_PER_MILE = 1609.344;

/** Evergreen, San José: where "from home" means when the screen has no start. */
export const DEFAULT_HOME: { name: string; point: LatLng } = {
  name: "Evergreen, San José",
  point: { lat: 37.315, lng: -121.775 },
};

export interface RidePrefs {
  /** How far the rider will go to start: anything up to and including this. */
  maxReach?: Reach;
  surfaces?: Surface[];
  /** Hardest acceptable. */
  maxDifficulty?: Difficulty;
  /** Easiest wanted ("I want a real workout"). */
  minDifficulty?: Difficulty;
  maxMiles?: number;
  /** What they like; rides matching more of these rank higher. */
  likes?: RideTag[];
  limit?: number;
}

export interface RideSuggestion {
  ride: RideIdea;
  milesFromHome: number;
  reach: Reach;
  /** Which of the rider's likes it has. */
  matched: RideTag[];
  /** The app's region the start lies in, if it can route there. */
  routableIn: RegionId | null;
}

export function reachFor(miles: number): Reach {
  return REACHES.find((r) => miles <= REACH_MAX_MILES[r])!;
}

export function suggestRides(prefs: RidePrefs, home: LatLng = DEFAULT_HOME.point, rides: RideIdea[] = RIDE_IDEAS): RideSuggestion[] {
  const maxReach = REACH_MAX_MILES[prefs.maxReach ?? "far"];
  const hardest = DIFFICULTIES.indexOf(prefs.maxDifficulty ?? "very-hard");
  const easiest = DIFFICULTIES.indexOf(prefs.minDifficulty ?? "easy");
  const likes = prefs.likes ?? [];
  return rides
    .map((ride) => {
      const milesFromHome = haversineMeters(home, ride.start.point) / METERS_PER_MILE;
      return {
        ride,
        milesFromHome: Math.round(milesFromHome * 10) / 10,
        reach: reachFor(milesFromHome),
        matched: likes.filter((t) => ride.tags.includes(t)),
        routableIn: regionAt(ride.start.point),
      };
    })
    .filter(({ ride, milesFromHome }) => {
      const level = DIFFICULTIES.indexOf(ride.difficulty);
      return (
        milesFromHome <= maxReach &&
        level <= hardest &&
        level >= easiest &&
        (!prefs.surfaces?.length || prefs.surfaces.includes(ride.surface)) &&
        (prefs.maxMiles === undefined || ride.miles <= prefs.maxMiles)
      );
    })
    // Most likes matched first; among equals, the closer start.
    .sort((a, b) => b.matched.length - a.matched.length || a.milesFromHome - b.milesFromHome)
    .slice(0, prefs.limit ?? 5);
}

const LEVEL: Record<Difficulty, string> = { easy: "Easy", moderate: "Moderate", hard: "Hard", "very-hard": "Very hard" };
const SURFACE: Record<Surface, string> = { "paved-path": "car-free paved path", road: "road", dirt: "dirt / mountain bike" };

/**
 * The ride as the rider reads it in the chat: written here, not by the
 * model, so the plan and the "can the app map it" line are always the
 * researched ones.
 */
export function writeUp(s: RideSuggestion, homeName: string, here: RegionId): string {
  const { ride } = s;
  const what = ride.turnaround ? `map it, ${ride.start.name} to ${ride.turnaround.name}` : "map the way to the start";
  const inApp =
    s.routableIn === here
      ? `In BetterRoutes: ask and I will ${what}.`
      : s.routableIn
        ? `In BetterRoutes: switch the map to ${REGIONS[s.routableIn].name} and I can ${what}.`
        : "In BetterRoutes: no maps there yet, so follow the plan above.";
  return [
    `${ride.name} - ${ride.area}`,
    `${LEVEL[ride.difficulty]}, ${SURFACE[ride.surface]}, about ${ride.miles} mi and ${ride.climbFt.toLocaleString("en-US")} ft of climbing. Starts at ${ride.start.name}, ${s.milesFromHome} mi from ${homeName} as the crow flies.`,
    `Why: ${ride.why}`,
    `Plan: ${ride.plan}`,
    ride.transit && `Getting there: ${ride.transit}`,
    ride.cautions && `Watch out: ${ride.cautions}`,
    inApp,
  ]
    .filter(Boolean)
    .join("\n");
}
