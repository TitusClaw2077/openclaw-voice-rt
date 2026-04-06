import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceCallConfig } from "./config.js";
import type { CoreConfig } from "./core-bridge.js";
import { createVoiceCallBaseConfig } from "./test-fixtures.js";

const mocks = vi.hoisted(() => ({
  resolveVoiceCallConfig: vi.fn(),
  validateProviderConfig: vi.fn(),
  createConversationEngine: vi.fn(),
  managerInitialize: vi.fn(),
  webhookConstructor: vi.fn(),
  webhookSetEngine: vi.fn(),
  webhookStart: vi.fn(),
  webhookStop: vi.fn(),
  webhookGetMediaStreamHandler: vi.fn(),
  startTunnel: vi.fn(),
  setupTailscaleExposure: vi.fn(),
  cleanupTailscaleExposure: vi.fn(),
}));

vi.mock("./config.js", () => ({
  resolveVoiceCallConfig: mocks.resolveVoiceCallConfig,
  validateProviderConfig: mocks.validateProviderConfig,
}));

vi.mock("./conversation/index.js", () => ({
  createConversationEngine: mocks.createConversationEngine,
}));

vi.mock("./manager.js", () => ({
  CallManager: class {
    initialize = mocks.managerInitialize;
  },
}));

vi.mock("./webhook.js", () => ({
  VoiceCallWebhookServer: class {
    constructor(...args: unknown[]) {
      mocks.webhookConstructor(...args);
    }

    setEngine = mocks.webhookSetEngine;
    start = mocks.webhookStart;
    stop = mocks.webhookStop;
    getMediaStreamHandler = mocks.webhookGetMediaStreamHandler;
  },
}));

vi.mock("./tunnel.js", () => ({
  startTunnel: mocks.startTunnel,
}));

vi.mock("./webhook/tailscale.js", () => ({
  setupTailscaleExposure: mocks.setupTailscaleExposure,
  cleanupTailscaleExposure: mocks.cleanupTailscaleExposure,
}));

import { createVoiceCallRuntime } from "./runtime.js";

function createBaseConfig(): VoiceCallConfig {
  return createVoiceCallBaseConfig({ tunnelProvider: "ngrok" });
}

describe("createVoiceCallRuntime lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveVoiceCallConfig.mockImplementation((cfg: VoiceCallConfig) => cfg);
    mocks.validateProviderConfig.mockReturnValue({ valid: true, errors: [] });
    mocks.createConversationEngine.mockReturnValue({
      onCallConnected: vi.fn(),
      onSpeechStart: vi.fn(),
      onFinalTranscript: vi.fn(),
      speak: vi.fn(),
      interrupt: vi.fn(),
      onCallEnded: vi.fn(),
    });
    mocks.managerInitialize.mockResolvedValue(undefined);
    mocks.webhookStart.mockResolvedValue("http://127.0.0.1:3334/voice/webhook");
    mocks.webhookStop.mockResolvedValue(undefined);
    mocks.webhookGetMediaStreamHandler.mockReturnValue(undefined);
    mocks.startTunnel.mockResolvedValue(null);
    mocks.setupTailscaleExposure.mockResolvedValue(null);
    mocks.cleanupTailscaleExposure.mockResolvedValue(undefined);
  });

  it("cleans up tunnel, tailscale, and webhook server when init fails after start", async () => {
    const tunnelStop = vi.fn().mockResolvedValue(undefined);
    mocks.startTunnel.mockResolvedValue({
      publicUrl: "https://public.example/voice/webhook",
      provider: "ngrok",
      stop: tunnelStop,
    });
    mocks.managerInitialize.mockRejectedValue(new Error("init failed"));

    await expect(
      createVoiceCallRuntime({
        config: createBaseConfig(),
        coreConfig: {},
      }),
    ).rejects.toThrow("init failed");

    expect(tunnelStop).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupTailscaleExposure).toHaveBeenCalledTimes(1);
    expect(mocks.webhookStop).toHaveBeenCalledTimes(1);
  });

  it("creates the configured conversation engine and passes it to the webhook server", async () => {
    const runtime = await createVoiceCallRuntime({
      config: createBaseConfig(),
      coreConfig: {} as CoreConfig,
    });

    expect(mocks.createConversationEngine).toHaveBeenCalledTimes(1);
    const [engineConfig, engineDeps] = mocks.createConversationEngine.mock.calls[0] ?? [];
    expect(engineConfig).toBe(runtime.config);
    expect(engineDeps).toMatchObject({
      coreConfig: {},
      manager: runtime.manager,
    });
    expect(mocks.webhookConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.webhookConstructor.mock.calls[0]).toEqual([
      runtime.config,
      runtime.manager,
      runtime.provider,
      {},
    ]);
    expect(mocks.webhookSetEngine).toHaveBeenCalledWith(runtime.engine);
  });

  it("returns an idempotent stop handler", async () => {
    const tunnelStop = vi.fn().mockResolvedValue(undefined);
    mocks.startTunnel.mockResolvedValue({
      publicUrl: "https://public.example/voice/webhook",
      provider: "ngrok",
      stop: tunnelStop,
    });

    const runtime = await createVoiceCallRuntime({
      config: createBaseConfig(),
      coreConfig: {} as CoreConfig,
    });

    await runtime.stop();
    await runtime.stop();

    expect(tunnelStop).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupTailscaleExposure).toHaveBeenCalledTimes(1);
    expect(mocks.webhookStop).toHaveBeenCalledTimes(1);
  });
});
