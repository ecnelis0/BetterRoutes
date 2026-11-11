import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { runAssistant, systemPrompt, withRidePlans } from "./agent";
import { describeActions, type AssistantContext } from "./actions";
import { haversineMeters } from "../geo";
import { distanceToPath } from "../ui/geometry";

// No network in tests: "Ocean Beach" and "Chinatown" resolve, "Atlantis" does not.
const lookups = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock("../geocode", () => ({
  geocode: async (q: string) => {
    lookups.asked.push(q);
    if (/ocean beach/i.test(q)) return [{ label: "Ocean Beach, Sunset District, San Francisco", lat: 37.7561, lng: -122.5102 }];
    if (/chinatown/i.test(q)) return [{ label: "Chinatown, San Francisco", lat: 37.7941, lng: -122.4078 }];
    return [];
  },
}));

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that makes these tool calls on its first turn, then says `reply`. */
function scripted(calls: { toolName: string; input: object }[], reply: string) {
  let turn = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      turn++;
      if (turn === 1 && calls.length) {
        return {
          content: calls.map((c, i) => ({
            type: "tool-call" as const,
            toolCallId: `call-${i}`,
            toolName: c.toolName,
            input: JSON.stringify(c.input),
          })),
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage,
          warnings: [],
        };
      }
      return { content: [{ type: "text" as const, text: reply }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
}

const ctx: AssistantContext = {
  from: "Marina Green",
  to: "Inner Sunset",
  settings: { avoidHills: false, fewerLights: false },
  interests: [],
  routes: ["Fastest: 4.6 mi, ~45 min", "Safest: 5.2 mi, ~51 min"],
  selected: { label: "Fastest", facts: ["✕ Did not avoid hills"] },
  myRoute: null,
};
const confirmed: AssistantContext = {
  ...ctx,
  myRoute: { label: "My route (Safest)", stops: 2, avoidsHills: false, fewerLights: false, summary: "5.2 mi, ~51 min" },
};

describe("route assistant", () => {
  it("turns a request into the app's own actions, with places looked up", async () => {
    const model = scripted(
      [
        { toolName: "set_settings", input: { avoidHills: true } },
        { toolName: "set_interests", input: { interests: ["beach", "boba"] } },
        { toolName: "add_stop", input: { place: "Ocean Beach" } },
      ],
      "Turned on Avoid hills, added beaches and boba, and routed you via Ocean Beach."
    );
    const out = await runAssistant(model, [{ role: "user", content: "flat ride past the beach with boba, via Ocean Beach" }], ctx);
    expect(out.reply).toContain("Avoid hills");
    expect(out.actions).toEqual([
      { type: "set_settings", avoidHills: true },
      { type: "set_interests", interests: ["beach", "boba"] },
      { type: "add_stop", label: "Ocean Beach, Sunset District, San Francisco", point: { lat: 37.7561, lng: -122.5102 } },
    ]);
    expect(describeActions(out.actions)).toEqual([
      "Avoid hills on",
      "Interests: beach, boba",
      "Added stop: Ocean Beach",
    ]);
  });

  it("never invents a stop it could not find", async () => {
    const model = scripted([{ toolName: "add_stop", input: { place: "Atlantis" } }], "I couldn't find Atlantis.");
    const out = await runAssistant(model, [{ role: "user", content: "go via Atlantis" }], ctx);
    expect(out.actions).toEqual([]);
  });

  it("rejects interests that do not exist rather than passing them on", async () => {
    const model = scripted([{ toolName: "set_interests", input: { interests: ["casinos"] } }], "Sorry.");
    const out = await runAssistant(model, [{ role: "user", content: "casinos please" }], ctx);
    expect(out.actions).toEqual([]);
  });

  it("edits the confirmed route: removes a stop, asks for a faster version", async () => {
    const model = scripted(
      [
        { toolName: "remove_stop", input: { stop: 2 } },
        { toolName: "improve_route", input: { goal: "faster" } },
      ],
      "Dropped stop 2 and looked for a faster way."
    );
    const out = await runAssistant(model, [{ role: "user", content: "drop the second stop and make it quicker" }], confirmed);
    expect(out.actions).toEqual([
      { type: "remove_stop", stop: 2 },
      { type: "improve_route", goal: "faster" },
    ]);
  });

  it("cannot edit 'my route' before one is confirmed, or remove a stop that is not there", async () => {
    const before = await runAssistant(
      scripted([{ toolName: "improve_route", input: { goal: "flatter" } }], "Confirm a route first."),
      [{ role: "user", content: "make it flatter" }],
      ctx
    );
    expect(before.actions).toEqual([]);
    const missing = await runAssistant(
      scripted([{ toolName: "remove_stop", input: { stop: 5 } }], "There is no stop 5."),
      [{ role: "user", content: "remove stop 5" }],
      confirmed
    );
    expect(missing.actions).toEqual([]);
  });

  describe("a customized 'For you' ride", () => {
    const CHINATOWN = { lat: 37.7941, lng: -122.4078 };
    const trip: AssistantContext = {
      ...ctx,
      points: { origin: { lat: 37.8029843, lng: -122.4374715 }, destination: { lat: 37.7274507, lng: -122.4749029 } },
    };
    const ask = (stops: object[], c: AssistantContext = trip) =>
      runAssistant(
        scripted([{ toolName: "make_for_you_route", input: { basedOn: "balanced", avoidHills: true, fewerLights: false, stops } }], "Built it."),
        [{ role: "user", content: "avoid hills and dangerous neighborhoods, but still pass chinatown for boba and food" }],
        c
      );

    it("is one action holding the whole request, with real places near where the rider said", async () => {
      lookups.asked.length = 0;
      const out = await ask([{ place: "Chinatown", kind: "boba" }, { place: "Chinatown", kind: "food" }, { place: "Ocean Beach" }]);
      expect(out.actions).toHaveLength(1);
      const a = out.actions[0];
      if (a.type !== "for_you_route") throw new Error(`got ${a.type}`);
      expect(a).toMatchObject({ basedOn: "balanced", avoidHills: true, fewerLights: false });
      expect(a.stops.map((s) => s.emoji)).toEqual(["🧋", "🍜", "📍"]);
      // The boba and food stops are different places, both in walking reach of Chinatown.
      expect(a.stops[0].name).not.toBe(a.stops[1].name);
      for (const s of a.stops.slice(0, 2)) expect(haversineMeters(s.point, CHINATOWN)).toBeLessThan(1200);
      expect(a.stops[2]).toEqual({ name: "Ocean Beach", emoji: "📍", point: { lat: 37.7561, lng: -122.5102 } });
      // "Chinatown" was asked for twice and looked up once.
      expect(lookups.asked.filter((q) => /chinatown/i.test(q))).toHaveLength(1);
      expect(describeActions(out.actions)[0]).toMatch(/^For you: Safest rules · avoids hills · via .+, .+, Ocean Beach$/);
    });

    it("finds a kind of place on the way when no neighbourhood is named", async () => {
      const out = await ask([{ kind: "park" }]);
      const a = out.actions[0];
      if (a?.type !== "for_you_route") throw new Error("no ride");
      expect(a.stops[0].emoji).toBe("🌳");
      // On the way: close to the straight line of the trip, not across town.
      expect(distanceToPath(a.stops[0].point, [trip.points!.origin, trip.points!.destination])).toBeLessThan(300);
    });

    it("builds nothing without a trip, or with a place it could not find", async () => {
      expect((await ask([{ place: "Chinatown" }], ctx)).actions).toEqual([]);
      expect((await ask([{ place: "Atlantis", kind: "boba" }])).actions).toEqual([]);
      expect((await ask([{}])).actions).toEqual([]);
    });

    it("is planned for the trip set in the same reply", async () => {
      const out = await runAssistant(
        scripted(
          [
            { toolName: "set_trip", input: { from: "Chinatown", to: "Ocean Beach" } },
            { toolName: "make_for_you_route", input: { basedOn: "fastest", avoidHills: false, fewerLights: true, stops: [{ kind: "coffee" }] } },
          ],
          "Done."
        ),
        [{ role: "user", content: "chinatown to ocean beach, few lights, coffee on the way" }],
        { ...ctx, from: null, to: null }
      );
      expect(out.actions.map((a) => a.type)).toEqual(["set_trip", "for_you_route"]);
    });

    it("the model is told what the ride holds now, and to ask for it in one call - but not the coordinates", () => {
      const p = systemPrompt({ ...trip, forYou: { basedOn: "balanced", avoidsHills: true, fewerLights: false, stops: ["Boba Guys"] } });
      expect(p).toContain("ONE call to");
      expect(p).toContain("Boba Guys");
      expect(p).not.toContain("37.8029843");
    });
  });


  describe("ride ideas", () => {
    /** Runs one suggest_rides call and returns what the tool told the model. */
    async function suggest(input: object, context: AssistantContext = ctx) {
      let toolOutput: unknown;
      let turn = 0;
      const model = new MockLanguageModelV4({
        doGenerate: async (opts) => {
          turn++;
          if (turn === 1) {
            return {
              content: [{ type: "tool-call" as const, toolCallId: "c0", toolName: "suggest_rides", input: JSON.stringify(input) }],
              finishReason: { unified: "tool-calls" as const, raw: undefined },
              usage,
              warnings: [],
            };
          }
          const toolMsg = opts.prompt.find((m) => m.role === "tool");
          const part = toolMsg?.content.find((c) => c.type === "tool-result");
          toolOutput = part && "output" in part ? (part.output as { value: unknown }).value : undefined;
          return { content: [{ type: "text" as const, text: "Here are some rides." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
        },
      });
      const out = await runAssistant(model, [{ role: "user", content: "where should I ride?" }], context);
      return { out, result: toolOutput as { ok: boolean; error?: string; measuredFrom?: string; rides?: { name: string; canPlanHere: boolean; writeUp: string }[] } };
    }

    it("hands the model only researched rides that fit, with why and a plan, and changes nothing", async () => {
      const { out, result } = await suggest({ maxReach: "nearby", surfaces: ["paved-path"], likes: ["family"] });
      expect(out.actions).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.measuredFrom).toMatch(/Evergreen/);
      expect(result.rides!.length).toBeGreaterThan(0);
      for (const r of result.rides!) {
        expect(r.writeUp).toMatch(/car-free paved path/);
        expect(r.writeUp).toMatch(/\nWhy: .{20,}\nPlan: .{20,}/);
      }
      expect(result.rides!.map((r) => r.name)).toContain("Coyote Creek Trail");
    });

    it("says which rides the app can plan: SF rides here in SF, after switching from San José, coast rides nowhere yet", async () => {
      const inSf = new Map((await suggest({ likes: ["coast"] })).result.rides!.map((r) => [r.name, r]));
      expect(inSf.get("Golden Gate Bridge to Sausalito (ferry back)")!.canPlanHere).toBe(true);
      expect(inSf.get("Golden Gate Bridge to Sausalito (ferry back)")!.writeUp).toMatch(/ask and I will map it, Aquatic Park, San Francisco to Golden Gate Bridge Welcome Center\.$/);
      expect(inSf.get("Tunitas Creek + coast loop")!.canPlanHere).toBe(false);
      expect(inSf.get("Tunitas Creek + coast loop")!.writeUp).toMatch(/no maps there yet/);
      const fromSj = (await suggest({ likes: ["coast"] }, { ...ctx, region: "sanjose" })).result.rides!;
      const ggb = fromSj.find((r) => r.name.startsWith("Golden Gate Bridge"))!;
      expect(ggb.canPlanHere).toBe(false);
      expect(ggb.writeUp).toMatch(/switch the map to San Francisco/);
    });

    it("measures from a place the rider names, and refuses one it cannot find", async () => {
      const { result } = await suggest({ from: "Chinatown", maxReach: "nearby" });
      expect(result.measuredFrom).toBe("Chinatown, San Francisco");
      for (const r of result.rides!) expect(r.writeUp).toMatch(/from Chinatown as the crow flies/);
      expect(result.rides!.map((r) => r.name)).not.toContain("Coyote Creek Trail");
      const lost = await suggest({ from: "Atlantis" });
      expect(lost.result).toMatchObject({ ok: false });
    });

    it("says so when nothing fits instead of stretching the wishes", async () => {
      const { result } = await suggest({ maxReach: "nearby", minDifficulty: "very-hard", surfaces: ["dirt"] });
      expect(result).toMatchObject({ ok: false });
    });

    it("adds the plan of any ride the reply names but did not write up, and never a second copy", () => {
      const rides = [
        { name: "Coyote Creek Trail", writeUp: "Coyote Creek Trail - South San José\nPlan: A" },
        { name: "Bay Trail: Shoreline Park to Palo Alto Baylands", writeUp: "Bay Trail: Shoreline...\nPlan: B" },
        { name: "Old La Honda + Kings Mountain loop", writeUp: "Old La Honda...\nPlan: C" },
      ];
      expect(withRidePlans("Try the bay trail: shoreline park to palo alto baylands.", rides)).toBe(
        "Try the bay trail: shoreline park to palo alto baylands.\n\nBay Trail: Shoreline...\nPlan: B"
      );
      // Named by its short name only.
      expect(withRidePlans("Old La Honda is the one.", rides)).toContain("Plan: C");
      const complete = `Two picks.\n\n${rides[0].writeUp}\n\n${rides[2].writeUp}`;
      expect(withRidePlans(complete, rides)).toBe(complete);
      expect(withRidePlans("Here is a good one for you.", rides)).toContain("Plan: A");
      expect(withRidePlans("Moved your start.", [])).toBe("Moved your start.");
    });

    it("completes the live reply too: a reply naming a ride gets its plan", async () => {
      let turn = 0;
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          turn++;
          if (turn === 1) {
            return {
              content: [{ type: "tool-call" as const, toolCallId: "c0", toolName: "suggest_rides", input: JSON.stringify({ maxReach: "nearby", surfaces: ["paved-path"] }) }],
              finishReason: { unified: "tool-calls" as const, raw: undefined },
              usage,
              warnings: [],
            };
          }
          return { content: [{ type: "text" as const, text: "Coyote Creek Trail is your ride." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
        },
      });
      const out = await runAssistant(model, [{ role: "user", content: "easy ride near me" }], { ...ctx, region: "sanjose" });
      expect(out.reply).toMatch(/^Coyote Creek Trail is your ride\.\n\nCoyote Creek Trail - South San José \/ Coyote Valley\n/);
      expect(out.reply).toContain("Plan: From Hellyer Park");
      expect(out.reply).toContain("ask and I will map it, Hellyer County Park to Metcalf Park.");
    });

    it("maps a researched ride by name: trails start to turnaround, only in the region on screen", async () => {
      const call = (ride: string, context: AssistantContext = ctx) =>
        runAssistant(scripted([{ toolName: "map_ride", input: { ride } }], "Mapped."), [{ role: "user", content: `map ${ride}` }], context);
      expect((await call("Embarcadero → Crissy Field waterfront")).actions).toEqual([
        {
          type: "set_trip",
          from: { label: "Caltrain 4th & King, San Francisco", point: { lat: 37.7766, lng: -122.3947 } },
          to: { label: "Crissy Field", point: { lat: 37.8035, lng: -122.465 } },
        },
      ]);
      // A climb has no turnaround on the street graph: map the way to its start.
      const sierra = (await call("sierra road climb", { ...ctx, region: "sanjose" })).actions;
      expect(sierra).toEqual([{ type: "set_trip", to: { label: "Sierra Rd at Piedmont Rd", point: { lat: 37.4011, lng: -121.8405 } } }]);
      expect((await call("Coyote Creek Trail")).actions).toEqual([]); // in San José, map shows SF
      expect((await call("Tunitas Creek + coast loop")).actions).toEqual([]);
      expect((await call("Atlantis Loop")).actions).toEqual([]);
    });

    it("is told to recommend only what the tool returns, and when it may plan one", () => {
      const p = systemPrompt(ctx);
      expect(p).toContain("call suggest_rides");
      expect(p).toContain("never invent one");
      expect(p).toContain("never offer to map a ride without canPlanHere");
      expect(p).toContain("no markdown");
      expect(p).toContain("Asking for ideas changes nothing on screen");
    });
  });

  it("is told that once confirmed, requests edit the rider's own route", () => {
    expect(systemPrompt(confirmed)).toContain("it is THEIR route");
    expect(systemPrompt(confirmed)).toContain("My route (Safest)");
  });

  it("is told the safety rules and what is on screen, so it explains instead of promising", () => {
    const p = systemPrompt(ctx);
    expect(p).toContain("never enter Severe areas");
    expect(p).toContain("Marina Green");
    expect(p).toContain("Fastest: 4.6 mi");
  });
});
