import { NextResponse } from "next/server";
import { geocodeAnyRegion, type GeocodeHit } from "@/lib/geocode";
import { DEFAULT_REGION, isRegionId } from "@/lib/data/regions";

/** Address search for the address boxes - see lib/geocode.ts. */
export const runtime = "nodejs";

export type { GeocodeHit };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim();
  const region = params.get("region");
  if (!q || q.length < 3) {
    return NextResponse.json({ results: [] });
  }
  try {
    return NextResponse.json({ results: await geocodeAnyRegion(q, isRegionId(region) ? region : DEFAULT_REGION) });
  } catch (err) {
    return NextResponse.json(
      {
        results: [],
        error: `Address lookup failed: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }
}
