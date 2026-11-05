import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeAnyRegion } from "./geocode";

const place = (name: string, lat: number, lon: number) => ({ display_name: name, lat: String(lat), lon: String(lon) });
const SIENA = place("4225 Siena Court, San Jose", 37.3163, -121.7732);
const SF_CAFE = place("Cafe, San Francisco", 37.78, -122.41);
const OAKLAND = place("Cafe, Oakland", 37.8044, -122.2712);

function nominatim(answer: (limit: string) => unknown[]) {
  const mock = vi.fn(async (url: string) => {
    return new Response(JSON.stringify(answer(new URL(url).searchParams.get("limit")!)));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("geocodeAnyRegion", () => {
  it("finds a San José address while San Francisco is selected, in one request", async () => {
    const mock = nominatim(() => [SIENA]);
    const hits = await geocodeAnyRegion("4225 siena ct", "sf");
    expect(hits).toEqual([{ label: SIENA.display_name, lat: 37.3163, lng: -121.7732 }]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("lists the selected area first, whichever order Nominatim ranked them", async () => {
    nominatim(() => [SF_CAFE, SIENA]);
    const hits = await geocodeAnyRegion("x", "sanjose");
    expect(hits.map((h) => h.label)).toEqual([SIENA.display_name, SF_CAFE.display_name]);
  });

  it("drops matches in cities the router cannot reach yet", async () => {
    nominatim(() => [OAKLAND, SF_CAFE]);
    expect((await geocodeAnyRegion("x", "sf")).map((h) => h.label)).toEqual([SF_CAFE.display_name]);
  });

  it("asks the selected area directly when another area filled the whole page", async () => {
    const mock = nominatim((limit) => (limit === "40" ? Array(40).fill(SF_CAFE) : [SIENA]));
    const hits = await geocodeAnyRegion("starbucks", "sanjose");
    expect(hits.map((h) => h.label)).toEqual([SIENA.display_name]);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("returns nothing, without a second request, when nowhere knows the place", async () => {
    const mock = nominatim(() => []);
    expect(await geocodeAnyRegion("zzzz", "sf")).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
