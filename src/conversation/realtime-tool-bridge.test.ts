import { describe, expect, it } from "vitest";
import { MinimalRealtimeToolBridge } from "./realtime-tool-bridge.js";

const fixedNow = () => new Date("2026-04-09T02:38:00.000Z");
const fixedTimeZone = "UTC";

describe("MinimalRealtimeToolBridge", () => {
  it("answers combined current day and time questions", async () => {
    const bridge = new MinimalRealtimeToolBridge({
      now: fixedNow,
      timeZone: fixedTimeZone,
    });

    const result = await bridge.handle({
      transcript: "what day is it and what time is it?",
    });

    expect(result).toEqual({
      spoken: "It's Thursday, 2:38 AM UTC.",
    });
  });

  it("answers day-of-week questions", async () => {
    const bridge = new MinimalRealtimeToolBridge({
      now: fixedNow,
      timeZone: fixedTimeZone,
    });

    const result = await bridge.handle({
      transcript: "what day of the week is it?",
    });

    expect(result).toEqual({
      spoken: "Today is Thursday.",
    });
  });

  it("returns null for unsupported queries", async () => {
    const bridge = new MinimalRealtimeToolBridge({
      now: fixedNow,
      timeZone: fixedTimeZone,
    });

    await expect(bridge.handle({ transcript: "tell me a joke" })).resolves.toBeNull();
  });

  it("does not answer location-specific time questions with the local clock", async () => {
    const bridge = new MinimalRealtimeToolBridge({
      now: fixedNow,
      timeZone: fixedTimeZone,
    });

    await expect(bridge.handle({ transcript: "what time is it in Tokyo?" })).resolves.toBeNull();
  });
});
