import type { VoiceCallConfig } from "../config.js";
import type { ConversationEngine, EngineDeps } from "./base.js";
import { LegacyEngine, bindLegacyInboundResponseHandler } from "./legacy-engine.js";
import { RealtimeEngine } from "./realtime-engine.js";

export function createConversationEngine(
  config: VoiceCallConfig,
  deps: EngineDeps,
): ConversationEngine {
  if (config.conversationEngine === "realtime") {
    return new RealtimeEngine(config, deps);
  }
  return new LegacyEngine(config, deps);
}

export { LegacyEngine, RealtimeEngine, bindLegacyInboundResponseHandler };
export type { ConversationEngine, EngineDeps };
