import type { LatLng } from "../types";

/**
 * Hand-picked rides from the South Bay up to San Francisco, for the
 * assistant's "where should I ride?" answers (lib/rides/suggest.ts).
 *
 * Researched 2026-11-10 from PJAMM, Bay Area Rides, MTB Project,
 * Singletracks, TrailLink, Komoot, SF Rec & Park and Streetsblog; each ride
 * lists its sources. Miles and feet are the sources' figures, rounded, and
 * vary with where you start: they are for choosing a ride, not for training.
 * Start points are approximate trailheads/meeting spots, not exact parking.
 *
 * These are ideas, not safety claims: most of them lie outside the areas the
 * app has street graphs for, and none of them has crash data behind it.
 */

export type Surface = "paved-path" | "road" | "dirt";
export type Difficulty = "easy" | "moderate" | "hard" | "very-hard";
export const RIDE_TAGS = [
  "views",
  "family",
  "climb",
  "flat",
  "coast",
  "water",
  "history",
  "mtb",
  "car-free",
  "food",
  "city",
  "wildlife",
  "redwoods",
] as const;
export type RideTag = (typeof RIDE_TAGS)[number];

export interface RideIdea {
  id: string;
  name: string;
  area: string;
  start: { name: string; point: LatLng };
  surface: Surface;
  difficulty: Difficulty;
  /** Typical ride length, miles (out-and-back or loop as described in `plan`). */
  miles: number;
  /** Typical climbing, feet. */
  climbFt: number;
  tags: RideTag[];
  why: string;
  plan: string;
  /**
   * The ride as a trip the app can map: start to turnaround, both inside one
   * region. Only for rides whose way there is the ride itself (trails and
   * flat waterfronts); climbs leave the street graph, so they have none.
   */
  turnaround?: { name: string; point: LatLng };
  /** Getting there without a car, when there is a good way. */
  transit?: string;
  cautions?: string;
  sources: string[];
}

export const RIDE_IDEAS: RideIdea[] = [
  // ---- Near Evergreen: ride there from home ----
  {
    id: "coyote-creek-trail",
    name: "Coyote Creek Trail",
    area: "South San José / Coyote Valley",
    start: { name: "Hellyer County Park", point: { lat: 37.281, lng: -121.811 } },
    turnaround: { name: "Metcalf Park", point: { lat: 37.2275, lng: -121.7462 } },
    surface: "paved-path",
    difficulty: "easy",
    miles: 20,
    climbFt: 300,
    tags: ["flat", "car-free", "water", "wildlife", "family"],
    why: "One of San José's longest car-free paths, right next to Evergreen: creek-side, mostly flat and paved, past the Ogier ponds and horse pastures of Coyote Valley.",
    plan: "From Hellyer Park ride south along Coyote Creek to Metcalf Park or the Ogier ponds and back (about 20 mi). Shorten by turning at Silver Creek Valley Rd; stretch to Anderson Lake for ~35 mi.",
    cautions: "Some stretches are exposed and hot in summer; bring water.",
    sources: ["https://www.traillink.com/cityactivity/san-jose-ca-mountain-biking-trails/", "https://www.komoot.com/guide/1935320/cycling-around-san-jose"],
  },
  {
    id: "evergreen-silver-creek-loop",
    name: "Evergreen – Silver Creek Valley – Coyote Creek loop",
    area: "Evergreen, San José",
    start: { name: "Evergreen Valley College", point: { lat: 37.3005, lng: -121.7615 } },
    surface: "road",
    difficulty: "moderate",
    miles: 25,
    climbFt: 1000,
    tags: ["climb", "views", "car-free"],
    why: "A local classic: Silver Creek Valley Rd is a real hill with bike lanes and a fun descent, joined to the car-free Coyote Creek Trail for the flat part.",
    plan: "Evergreen Valley College → over Silver Creek Valley Rd (bike lanes) → Coyote Creek Trail south as far as you like → back up Silver Creek Valley Rd into Evergreen. Komoot's long version runs ~40 mi via the Ogier ponds.",
    sources: ["https://www.komoot.com/guide/1935320/cycling-around-san-jose", "https://rhorii.com/BABP/coytecrk.htm"],
  },
  {
    id: "metcalf-san-felipe",
    name: "Metcalf Road + San Felipe Road loop",
    area: "Evergreen / Coyote Valley foothills",
    start: { name: "Metcalf Park, Coyote Creek Trail", point: { lat: 37.2275, lng: -121.7462 } },
    surface: "road",
    difficulty: "hard",
    miles: 18,
    climbFt: 1600,
    tags: ["climb", "views"],
    why: "The steep, short climb South Bay riders use for training, with big views over Coyote Valley, then rolling San Felipe Rd back into Evergreen.",
    plan: "Coyote Creek Trail to Metcalf Rd → climb Metcalf past the motorcycle park → right on San Felipe Rd → roll back down into Evergreen. Reverse it to climb the gentler backside instead.",
    cautions: "Metcalf is narrow and steep with fast descending traffic; no shoulder in places.",
    sources: ["https://bikeclimbs.com/climb/united-states/california/santa-clara-county/metcalf-road/metcalf-backside-from-san-felipe-split-to-top", "https://www.bikemap.net/en/r/2144247"],
  },
  {
    id: "alum-rock-penitencia",
    name: "Penitencia Creek Trail to Alum Rock Park",
    area: "East San José",
    start: { name: "Penitencia Creek Park", point: { lat: 37.388, lng: -121.851 } },
    turnaround: { name: "Alum Rock Park", point: { lat: 37.3965, lng: -121.799 } },
    surface: "paved-path",
    difficulty: "easy",
    miles: 9,
    climbFt: 400,
    tags: ["family", "car-free", "water", "history"],
    why: "A gentle creek path into San José's oldest park, a canyon with old mineral-spring grottos; the park also has ~4 mi of intermediate dirt trails if you want more.",
    plan: "Ride the Penitencia Creek Trail east into Alum Rock Park, explore the canyon floor, and come back the same way (about 9 mi round trip).",
    cautions: "Alum Rock trails have closed after fires and mountain-lion sightings before; check the park page.",
    sources: ["https://mtbproject.com/directory/8017750/alum-rock-park", "https://gomilpitas.com/sports-recreation/trails-bike-paths"],
  },
  {
    id: "santa-teresa",
    name: "Santa Teresa County Park",
    area: "South San José",
    start: { name: "Santa Teresa County Park, Pueblo Day Use Area", point: { lat: 37.209, lng: -121.779 } },
    surface: "dirt",
    difficulty: "hard",
    miles: 12,
    climbFt: 1500,
    tags: ["mtb", "views", "climb"],
    why: "17+ miles of dirt trail on the hills above the Almaden Valley; Rocky Ridge is the advanced line, and the full tour looks out over Calero Reservoir.",
    plan: "Climb from Pueblo to the ridge, take Ohlone → Rocky Ridge, and loop back via Stiles Ranch (rated advanced). Beginners can stay on the fire roads near Pueblo.",
    sources: ["https://www.mtbproject.com/directory/8007189/san-jose", "https://www.singletracks.com/bike-trails/region/california/?city=Los+Gatos"],
  },

  // ---- South Bay: a short drive (or a long ride) ----
  {
    id: "mt-hamilton",
    name: "Mount Hamilton to Lick Observatory",
    area: "East foothills, San José",
    start: { name: "Mt Hamilton Rd at Alum Rock Ave", point: { lat: 37.3711, lng: -121.8025 } },
    surface: "road",
    difficulty: "very-hard",
    miles: 37,
    climbFt: 4300,
    tags: ["climb", "views", "history"],
    why: "The South Bay's signature climb: 18 miles at a steady ~4% to an observatory on the summit, with views of the whole valley and very little traffic up top.",
    plan: "Climb Mt Hamilton Rd 18.4 mi to Lick Observatory and descend the same way (~37 mi). Big-day version from one mapped loop: on the way down turn onto Quimby Rd, then climb Metcalf too (~66 mi, ~6,400 ft).",
    cautions: "No services after Grant Ranch; carry food, water and a layer for the descent.",
    sources: ["https://pjammcycling.com/climb/334.Mt.%20Hamilton%20West", "https://www.bikemap.net/en/r/2144247"],
  },
  {
    id: "sierra-road",
    name: "Sierra Road climb",
    area: "Berryessa, San José",
    start: { name: "Sierra Rd at Piedmont Rd", point: { lat: 37.4011, lng: -121.8405 } },
    surface: "road",
    difficulty: "very-hard",
    miles: 20,
    climbFt: 2000,
    tags: ["climb", "views"],
    why: "The steepest climb around San José (3.7 mi at ~9.5%); you get a huge view over the whole valley for a short ride.",
    plan: "Climb Sierra Rd from Piedmont, continue to Felter Rd, descend Felter and Calaveras Rd past Ed Levin Park, and roll back along Piedmont (~20 mi).",
    cautions: "The first half mile is over 10%; gear low.",
    sources: ["https://pjammcycling.com/climb/337.Sierra%20Road"],
  },
  {
    id: "calaveras-road",
    name: "Calaveras Road to Sunol",
    area: "Milpitas → Sunol",
    start: { name: "Ed Levin County Park", point: { lat: 37.4565, lng: -121.859 } },
    surface: "road",
    difficulty: "moderate",
    miles: 30,
    climbFt: 1800,
    tags: ["views", "water", "wildlife"],
    why: "A quiet, twisty road above Calaveras Reservoir with ranch land and very few cars, one of the prettiest rides close to San José.",
    plan: "Climb Calaveras Rd from Milpitas, follow it along the reservoir to Sunol and come back the same way (~30 mi), or add the Sierra Rd climb for a hard loop.",
    cautions: "Going counter-clockwise there is a steep quarter-mile before the junction.",
    sources: ["https://bayarearides.com/rides/calaverasroad", "https://www.singletracks.com/bike-trails/ed-levin-county-park/"],
  },
  {
    id: "guadalupe-river-trail",
    name: "Guadalupe River Trail to Alviso",
    area: "San José → Alviso",
    start: { name: "Almaden Lake Park", point: { lat: 37.2385, lng: -121.874 } },
    turnaround: { name: "Alviso Marina County Park", point: { lat: 37.4295, lng: -121.98 } },
    surface: "paved-path",
    difficulty: "easy",
    miles: 25,
    climbFt: 200,
    tags: ["flat", "car-free", "water", "city", "wildlife"],
    why: "12.5 mi of paved, car-free river path from Almaden Lake straight through downtown San José to the bay marshes at Alviso.",
    plan: "Almaden Lake Park → north along the river past downtown and the airport → Alviso Marina, then back (~25 mi), or end at Alviso and loop via the Bay Trail.",
    transit: "Starts near VTA light rail (Almaden/Ohlone-Chynoweth).",
    sources: ["https://www.traillink.com/gdbkpdf/trail/6366518/guadalupe-river-trail63909853226846-2026.pdf", "https://www.sjbikeparty.org/2021/163705832608447/"],
  },
  {
    id: "almaden-quicksilver",
    name: "Almaden Quicksilver County Park",
    area: "Almaden, San José",
    start: { name: "Almaden Quicksilver, Hacienda entrance", point: { lat: 37.1594, lng: -121.8238 } },
    surface: "dirt",
    difficulty: "moderate",
    miles: 11,
    climbFt: 1400,
    tags: ["mtb", "history", "views"],
    why: "Fire roads past the old mercury mines and miners' camps; history at every turn and wide trails that are friendly to a first mountain-bike ride.",
    plan: "The park's main bike loop from the Hacienda entrance (~10.8 mi, ~1,400 ft), with side trips to the mine buildings.",
    sources: ["https://www.mtbproject.com/directory/8007189/san-jose", "https://bayarearides.com/southbay.shtml"],
  },
  {
    id: "mt-umunhum",
    name: "Mount Umunhum via Hicks Road",
    area: "Sierra Azul, above Almaden",
    start: { name: "Almaden Lake Park", point: { lat: 37.2385, lng: -121.874 } },
    surface: "road",
    difficulty: "very-hard",
    miles: 30,
    climbFt: 4000,
    tags: ["climb", "views", "history"],
    why: "The Cube on top is an old radar tower with 360° views; Hicks Rd is ranked among the steepest road climbs in California.",
    plan: "Ride Camden/Almaden to Hicks Rd, climb past Guadalupe Reservoir, turn up Mt Umunhum Rd to the summit, then descend the same way.",
    cautions: "Narrow roads with no shoulder or bike lanes; the hardest sustained grades in the county.",
    sources: ["https://pjammcycling.com/climb/445.Hicks%20Road%20to%20Mt.%20Umunhum%20north", "https://trailforks.com/trails/mt-umunhum"],
  },
  {
    id: "los-gatos-creek-trail",
    name: "Los Gatos Creek Trail",
    area: "Campbell → Los Gatos",
    start: { name: "Campbell Park", point: { lat: 37.2867, lng: -121.9465 } },
    turnaround: { name: "Downtown Los Gatos", point: { lat: 37.2266, lng: -121.9817 } },
    surface: "paved-path",
    difficulty: "easy",
    miles: 14,
    climbFt: 400,
    tags: ["family", "car-free", "water", "food"],
    why: "A paved creek path through the Campbell percolation ponds into downtown Los Gatos, good for coffee and lunch; keep going to Lexington Reservoir if you want a climb.",
    plan: "Campbell Park → south along the creek → downtown Los Gatos for food → back (~14 mi). Add the dirt stretch up to Lexington Dam for more.",
    sources: ["https://www.traillink.com/cityactivity/los-gatos-ca-bike-trails/"],
  },
  {
    id: "fremont-older",
    name: "Fremont Older Open Space",
    area: "Cupertino / Saratoga",
    start: { name: "Fremont Older Open Space, Prospect Rd", point: { lat: 37.2895, lng: -122.0475 } },
    surface: "dirt",
    difficulty: "moderate",
    miles: 7,
    climbFt: 700,
    tags: ["mtb", "views"],
    why: "The friendliest dirt near the West Valley: 14 mi of trails, and Hunters Point gives a view over the whole valley for a short climb.",
    plan: "Loop up to Hunters Point and around the preserve's fire roads (~7 mi). Good first mountain-bike ride.",
    sources: ["https://www.singletracks.com/bike-trails/region/california/?city=Los+Gatos", "https://www.cbsnews.com/amp/sanfrancisco/news/best-bay-area-mountain-biking-spots"],
  },
  {
    id: "henry-coe",
    name: "Henry W. Coe State Park",
    area: "Morgan Hill",
    start: { name: "Henry Coe State Park headquarters", point: { lat: 37.187, lng: -121.547 } },
    surface: "dirt",
    difficulty: "very-hard",
    miles: 15,
    climbFt: 3000,
    tags: ["mtb", "climb", "wildlife", "views"],
    why: "Northern California's largest state park: real backcountry with technical singletrack and creek crossings, under an hour from Evergreen.",
    plan: "Middle Ridge Loop from headquarters for technical singletrack without the very steepest climbs, or Grizzly Gulch (~9.5 mi, 2,600 ft) for creek crossings.",
    cautions: "Remote and very hot in summer; carry more water than you think. Go in spring.",
    sources: ["https://bayarearides.com/southbay.shtml", "https://www.singletracks.com/bike-trails/region/california/?city=Morgan%20Hill"],
  },

  // ---- Peninsula & Bay shore: a day trip ----
  {
    id: "shoreline-baylands",
    name: "Bay Trail: Shoreline Park to Palo Alto Baylands",
    area: "Mountain View / Palo Alto",
    start: { name: "Shoreline Lake boathouse, Mountain View", point: { lat: 37.432, lng: -122.087 } },
    surface: "paved-path",
    difficulty: "easy",
    miles: 12,
    climbFt: 100,
    tags: ["flat", "family", "car-free", "water", "wildlife"],
    why: "Flat levee paths beside the bay marshes, full of birds, with a lake café at the start. The easiest scenic ride in the South Bay.",
    plan: "Shoreline Lake → Bay Trail north to the Palo Alto Baylands and back (~12 mi). The long version runs east to Alviso (~28 mi).",
    transit: "Caltrain to Mountain View, then the Stevens Creek Trail to Shoreline.",
    sources: ["https://westernwheelersbicycleclub.wildapricot.org/resources/Documents/Baylands%20to%20Alviso%201.pdf", "https://www.mtbproject.com/trail/gpx/7021185"],
  },
  {
    id: "old-la-honda-kings",
    name: "Old La Honda + Kings Mountain loop",
    area: "Woodside / Skyline",
    start: { name: "Woodside town center", point: { lat: 37.4295, lng: -122.256 } },
    surface: "road",
    difficulty: "hard",
    miles: 22,
    climbFt: 2800,
    tags: ["climb", "redwoods", "views"],
    why: "The Peninsula's benchmark climb: narrow, shaded and quiet through redwoods; riders time themselves on it. Skyline Blvd on top looks out over the ocean side.",
    plan: "Woodside → Portola Rd → climb Old La Honda to Skyline → north on Skyline → descend Kings Mountain Rd to Woodside (~22 mi). Alternative from Palo Alto: up Page Mill, down Old La Honda (~25 mi, 2,800 ft).",
    cautions: "Skyline traffic is fast on weekends; Old La Honda is one lane.",
    sources: ["https://bayarearides.com/rides/oldlahonda2/", "https://sepwww.stanford.edu/sep/morgan/adventures/biking/peninsula.html"],
  },
  {
    id: "tunitas-creek",
    name: "Tunitas Creek + coast loop",
    area: "Woodside → Half Moon Bay coast",
    start: { name: "Cañada College", point: { lat: 37.4483, lng: -122.2648 } },
    surface: "road",
    difficulty: "very-hard",
    miles: 36,
    climbFt: 4600,
    tags: ["climb", "coast", "redwoods", "views"],
    why: "Over the hills to the Pacific: ranch land and coast down one side, then Tunitas Creek's deep redwood climb back up. One of the most beautiful road rides in the Bay Area.",
    plan: "Cañada College → climb Kings Mountain to Skyline → descend Hwy 84 toward San Gregorio and the coast → climb back up Tunitas Creek Rd → descend Kings Mountain (~36 mi, 1,400 m of climbing).",
    cautions: "Remote, with no services on the climb; Hwy 1 has fast traffic.",
    sources: ["https://www.komoot.com/guide/1937546/road-cycling-routes-around-woodside"],
  },
  {
    id: "canada-road-sawyer-camp",
    name: "Cañada Road + Sawyer Camp Trail",
    area: "Woodside → San Mateo",
    start: { name: "Cañada Road at Edgewood Rd", point: { lat: 37.462, lng: -122.282 } },
    surface: "road",
    difficulty: "moderate",
    miles: 30,
    climbFt: 1200,
    tags: ["water", "views", "family", "wildlife"],
    why: "Rolling road past Crystal Springs Reservoir and the Pulgas Water Temple, then a car-free paved trail along the water; deer are common.",
    plan: "Cañada Rd north past the Water Temple → Sawyer Camp Trail along Crystal Springs Reservoir (6 mi each way) → back (~30 mi). On Bicycle Sunday mornings Cañada Rd is closed to cars, so check the San Mateo County Parks schedule.",
    sources: ["https://bayarearides.com/rides/canadaroad", "https://bayarearides.com/rides/sawyercamp"],
  },

  // ---- San Francisco & Marin: far (Caltrain makes it easy) ----
  {
    id: "golden-gate-sausalito",
    name: "Golden Gate Bridge to Sausalito (ferry back)",
    area: "San Francisco → Marin",
    start: { name: "Aquatic Park, San Francisco", point: { lat: 37.806, lng: -122.423 } },
    turnaround: { name: "Golden Gate Bridge Welcome Center", point: { lat: 37.8077, lng: -122.475 } },
    surface: "road",
    difficulty: "moderate",
    miles: 9,
    climbFt: 500,
    tags: ["views", "water", "food", "coast"],
    why: "The Bay Area's postcard ride: waterfront to Crissy Field, across the Golden Gate Bridge, down into Sausalito for lunch, and the ferry back past Alcatraz.",
    plan: "Aquatic Park → Marina → Crissy Field → climb to the bridge → cross → descend to Sausalito (~8–9 mi), ferry back to the Ferry Building. Add Hawk Hill (Conzelman Rd) on the Marin side for the classic bridge view.",
    transit: "Caltrain from Diridon or Tamien to 4th & King, then ride the Embarcadero to the start. Ferry tickets for bikes can sell out on weekends.",
    cautions: "The bridge path is busy and windy; take it slowly.",
    sources: ["https://bikeandroll.com/rides/bike-across-the-golden-gate-bridge-to-sausalito/", "https://bayarearides.com/rides/goldengate"],
  },
  {
    id: "golden-gate-park-sunset-dunes",
    name: "Golden Gate Park → Sunset Dunes → Lake Merced",
    area: "San Francisco west side",
    start: { name: "Panhandle at Masonic Ave, San Francisco", point: { lat: 37.772, lng: -122.4455 } },
    turnaround: { name: "Ocean Beach at Golden Gate Park", point: { lat: 37.7695, lng: -122.5105 } },
    surface: "paved-path",
    difficulty: "easy",
    miles: 14,
    climbFt: 300,
    tags: ["car-free", "coast", "family", "views", "city"],
    why: "Almost entirely car-free: the Panhandle, JFK Promenade through Golden Gate Park, then Sunset Dunes (the old Upper Great Highway, a 2-mile oceanfront park since 2025) and around Lake Merced.",
    plan: "Panhandle → JFK Promenade west to Ocean Beach → south along Sunset Dunes → loop Lake Merced → back through the park (~14 mi). Sunset Dunes has a pump track and bike skills course.",
    transit: "Caltrain to 4th & King, then about 4 mi through the city to the Panhandle.",
    cautions: "Wind off the ocean is strong in the afternoon; whether the old highway stays car-free is still debated locally.",
    sources: ["https://sfrecpark.org/GreatHighwayPilot", "https://sf.streetsblog.org/2026/04/27/san-francisco-celebrates-one-year-of-sunset-dunes"],
  },
  {
    id: "sf-waterfront",
    name: "Embarcadero → Crissy Field waterfront",
    area: "San Francisco",
    start: { name: "Caltrain 4th & King, San Francisco", point: { lat: 37.7766, lng: -122.3947 } },
    turnaround: { name: "Crissy Field", point: { lat: 37.8035, lng: -122.465 } },
    surface: "road",
    difficulty: "easy",
    miles: 12,
    climbFt: 100,
    tags: ["flat", "city", "food", "views", "water"],
    why: "Flat, easy and right off the train: Oracle Park, the Ferry Building, Fisherman's Wharf and the Marina to Crissy Field with the bridge in front of you the whole way.",
    plan: "4th & King → Embarcadero past the Ferry Building → Fisherman's Wharf → Marina Green → Crissy Field / Fort Point and back (~12 mi). Natural warm-up for the Sausalito ride.",
    transit: "Ride straight off Caltrain at 4th & King.",
    sources: ["https://blazingsaddles.com/san-francisco/routes-and-tours/self-guided"],
  },
];
