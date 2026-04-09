import { describe, expect, it, vi } from "vitest";
import type { WeatherProvider } from "./realtime-tool-bridge.js";
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

  it("delegates weather queries to the injected weather provider", async () => {
    const mockProvider: WeatherProvider = {
      getCurrent: vi.fn().mockResolvedValue({ spoken: "It's 72 degrees and sunny." }),
    };
    const bridge = new MinimalRealtimeToolBridge({
      now: fixedNow,
      timeZone: fixedTimeZone,
      weatherProvider: mockProvider,
    });

    const result = await bridge.handle({ transcript: "what's the weather like?" });
    expect(result).toEqual({ spoken: "It's 72 degrees and sunny." });
    expect(mockProvider.getCurrent).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable fallback when no weather provider is injected", async () => {
    const bridge = new MinimalRealtimeToolBridge({
      now: fixedNow,
      timeZone: fixedTimeZone,
    });

    const result = await bridge.handle({ transcript: "what's the weather?" });
    expect(result).not.toBeNull();
    expect(result?.spoken).toContain("don't have weather access");
  });

  it("does not match non-weather queries as weather", async () => {
    const bridge = new MinimalRealtimeToolBridge({ now: fixedNow, timeZone: fixedTimeZone });
    await expect(bridge.handle({ transcript: "tell me a joke" })).resolves.toBeNull();
  });
});
