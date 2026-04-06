import type { CoreConfig } from "../core-bridge.js";
import type { CallManager } from "../manager.js";
import type { CallRecord } from "../types.js";

export interface ConversationEngine {
  /** Called when a call is answered and media stream is established. */
  onCallConnected(call: CallRecord): Promise<void>;
  /** Called when the caller starts speaking (VAD speech_start). */
  onSpeechStart(callId: string): void;
  /** Called when a final transcript is ready from STT. */
  onFinalTranscript(callId: string, text: string): Promise<void>;
  /** Speak a message on the active call. */
  speak(callId: string, text: string, opts?: { interrupt?: boolean }): Promise<void>;
  /** Interrupt/cancel current TTS playback. */
  interrupt(callId: string): void;
  /** Called when a call ends (any reason). Cleanup resources. */
  onCallEnded(callId: string): Promise<void>;
}

export type EngineDeps = {
  coreConfig?: CoreConfig | null;
  manager: CallManager;
};

export type InboundResponseHandler = (callId: string, text: string) => Promise<void>;
