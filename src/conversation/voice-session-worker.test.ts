import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceCallBaseConfig } from "../test-fixtures.js";
import { MinimalRealtimeToolBridge } from "./realtime-tool-bridge.js";
import type { RealtimeToolBridge } from "./realtime-tool-bridge.js";
import { VoiceSessionWorker } from "./voice-session-worker.js";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("VoiceSessionWorker realtime tool bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the default bridge to handle day queries without calling the model", async () => {
    const manager = {
      speak: vi.fn(async () => ({ success: true })),
    };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const worker = new VoiceSessionWorker({
      callId: "call-default-bridge",
      config: createVoiceCallBaseConfig(),
      manager: manager as any,
      openaiApiKey: "test-key",
    });

    worker.handleTranscript("what day is it?");

    await flushMicrotasks();

    expect(manager.speak).toHaveBeenCalledWith(
      "call-default-bridge",
      expect.stringMatching(/^Today is .+\.$/),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the default bridge to handle time queries without calling the model", async () => {
    const manager = {
      speak: vi.fn(async () => ({ success: true })),
    };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const worker = new VoiceSessionWorker({
      callId: "call-default-time-bridge",
      config: createVoiceCallBaseConfig(),
      manager: manager as any,
      openaiApiKey: "test-key",
    });

    worker.handleTranscript("what time is it?");

    await flushMicrotasks();

    expect(manager.speak).toHaveBeenCalledWith(
      "call-default-time-bridge",
      expect.stringMatching(/^It's .+\.$/),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the default bridge to handle combined day and time queries without calling the model", async () => {
    const manager = {
      speak: vi.fn(async () => ({ success: true })),
    };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const worker = new VoiceSessionWorker({
      callId: "call-default-day-time-bridge",
      config: createVoiceCallBaseConfig(),
      manager: manager as any,
      openaiApiKey: "test-key",
    });

    worker.handleTranscript("what day is it and what time is it?");

    await flushMicrotasks();

    expect(manager.speak).toHaveBeenCalledWith(
      "call-default-day-time-bridge",
      expect.stringMatching(/^It's .+, .+\.$/),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("speaks bridge results without calling the model", async () => {
    const manager = {
      speak: vi.fn(async () => ({ success: true })),
    };
    const toolBridge = new MinimalRealtimeToolBridge({
      now: () => new Date("2026-04-09T02:38:00.000Z"),
      timeZone: "America/Chicago",
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const worker = new VoiceSessionWorker({
      callId: "call-1",
      config: createVoiceCallBaseConfig(),
      manager: manager as any,
      openaiApiKey: "test-key",
      toolBridge,
    });

    worker.handleTranscript("what day is it?");

    await flushMicrotasks();

    expect(manager.speak).toHaveBeenCalledWith("call-1", "Today is Wednesday.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the model when the bridge does not handle the transcript", async () => {
    const manager = {
      speak: vi.fn(async () => ({ success: true })),
    };
    const toolBridge: RealtimeToolBridge = {
      handle: vi.fn(async () => null),
    };
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "Hello from the model.",
              },
            },
          ],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const worker = new VoiceSessionWorker({
      callId: "call-2",
      config: createVoiceCallBaseConfig(),
      manager: manager as any,
      openaiApiKey: "test-key",
      toolBridge,
    });

    worker.handleTranscript("hello there");

    await flushMicrotasks();

    expect(manager.speak).toHaveBeenCalledWith("call-2", "Hello from the model.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
