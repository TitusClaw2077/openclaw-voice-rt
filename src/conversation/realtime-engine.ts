import type { VoiceCallConfig } from "../config.js";
import type { CallRecord } from "../types.js";
import type { ConversationEngine, EngineDeps } from "./base.js";

const NOT_IMPLEMENTED_ERROR = "RealtimeEngine not implemented — coming in M2";

export class RealtimeEngine implements ConversationEngine {
  constructor(
    _config: VoiceCallConfig,
    _deps: EngineDeps,
  ) {}

  async onCallConnected(_call: CallRecord): Promise<void> {
    throw new Error(NOT_IMPLEMENTED_ERROR);
  }

  onSpeechStart(_callId: string): void {
    throw new Error(NOT_IMPLEMENTED_ERROR);
  }

  async onFinalTranscript(_callId: string, _text: string): Promise<void> {
    throw new Error(NOT_IMPLEMENTED_ERROR);
  }

  async speak(_callId: string, _text: string, _opts?: { interrupt?: boolean }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED_ERROR);
  }

  interrupt(_callId: string): void {
    throw new Error(NOT_IMPLEMENTED_ERROR);
  }

  async onCallEnded(_callId: string): Promise<void> {
    throw new Error(NOT_IMPLEMENTED_ERROR);
  }
}
