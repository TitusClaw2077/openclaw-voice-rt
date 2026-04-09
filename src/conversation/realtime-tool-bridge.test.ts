import { describe, expect, it } from "vitest";
import { MinimalRealtimeToolBridge } from "./realtime-tool-bridge.js";

describe("MinimalRealtimeToolBridge", () => {
  it("answers combined current day and time questions", async () => {
    const bridge = new MinimalRealtimeToolBridge({
      now: () => new Date("2026-04-09T02:38:00.000Z"),
      timeZone: "America/Chicago",
    });

    const result = await bridge.handle({
      transcript: "what day is it and what time is it?",
    });

    expect(result).toEqual({
      spoken: "It's Wednesday, 9:38 PM CDT.",
    });
  });

  it("answers day-of-week questions", async () => {
    const bridge = new MinimalRealtimeToolBridge({
      now: () => new Date("2026-04-09T02:38:00.000Z"),
      timeZone: "America/Chicago",
    });

    const result = await bridge.handle({
      transcript: "what day of the week is it?",
    });

    expect(result).toEqual({
      spoken: "Today is Wednesday.",
    });
  });

  it("returns null for unsupported queries", async () => {
    const bridge = new MinimalRealtimeToolBridge({
      now: () => new Date("2026-04-09T02:38:00.000Z"),
      timeZone: "America/Chicago",
    });

    await expect(bridge.handle({ transcript: "tell me a joke" })).resolves.toBeNull();
  });

  it("does not answer location-specific time questions with the local clock", async () => {
    const bridge = new MinimalRealtimeToolBridge({
      now: () => new Date("2026-04-09T02:38:00.000Z"),
      timeZone: "America/Chicago",
    });

    await expect(bridge.handle({ transcript: "what time is it in Tokyo?" })).resolves.toBeNull();
  });
});
