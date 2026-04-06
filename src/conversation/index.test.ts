import { describe, expect, it } from "vitest";
import { createVoiceCallBaseConfig } from "../test-fixtures.js";
import { createConversationEngine, LegacyEngine, RealtimeEngine } from "./index.js";

const deps = {
  config: createVoiceCallBaseConfig(),
  coreConfig: {},
  manager: {
    getCall: () => undefined,
    getCallByProviderCallId: () => undefined,
    speak: async () => ({ success: true }),
  },
  provider: {
    name: "mock",
  },
} as any;

describe("createConversationEngine", () => {
  it("returns the legacy engine by default", () => {
    const config = createVoiceCallBaseConfig();

    const engine = createConversationEngine(config, deps);

    expect(engine).toBeInstanceOf(LegacyEngine);
  });

  it("returns the realtime engine when configured", () => {
    const config = { ...createVoiceCallBaseConfig(), conversationEngine: "realtime" as const };

    const engine = createConversationEngine(config, { ...deps, config });

    expect(engine).toBeInstanceOf(RealtimeEngine);
  });
});
