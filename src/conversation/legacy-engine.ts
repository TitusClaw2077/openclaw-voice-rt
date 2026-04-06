import type { VoiceCallConfig } from "../config.js";
import type { CallRecord } from "../types.js";
import type { TwilioProvider } from "../providers/twilio.js";
import type { ConversationEngine, EngineDeps, InboundResponseHandler } from "./base.js";

export class LegacyEngine implements ConversationEngine {
  private inboundResponseHandler: InboundResponseHandler | null = null;

  constructor(
    _config: VoiceCallConfig,
    private readonly deps: EngineDeps,
  ) {}

  bindInboundResponseHandler(handler: InboundResponseHandler): void {
    this.inboundResponseHandler = handler;
  }

  async onCallConnected(call: CallRecord): Promise<void> {
    console.debug(`[voice-call] LegacyEngine connected: ${call.callId}`);
  }

  onSpeechStart(callId: string): void {
    this.interrupt(callId);
  }

  async onFinalTranscript(callId: string, text: string): Promise<void> {
    if (!this.inboundResponseHandler) {
      throw new Error("LegacyEngine inbound response handler is not bound");
    }

    await this.inboundResponseHandler(callId, text);
  }

  async speak(callId: string, text: string, opts?: { interrupt?: boolean }): Promise<void> {
    if (opts?.interrupt) {
      this.interrupt(callId);
    }

    const result = await this.deps.manager.speak(callId, text);
    if (!result.success) {
      throw new Error(result.error ?? `Failed to speak on call ${callId}`);
    }
  }

  interrupt(callId: string): void {
    const provider = this.deps.manager.getProvider();
    if (provider?.name !== "twilio") {
      return;
    }

    const call =
      this.deps.manager.getCall(callId) ?? this.deps.manager.getCallByProviderCallId(callId);
    const providerCallId = call?.providerCallId ?? callId;
    (provider as TwilioProvider).clearTtsQueue(providerCallId);
  }

  async onCallEnded(callId: string): Promise<void> {
    console.debug(`[voice-call] LegacyEngine ended: ${callId}`);
  }
}

export function bindLegacyInboundResponseHandler(
  engine: ConversationEngine,
  handler: InboundResponseHandler,
): void {
  if (engine instanceof LegacyEngine) {
    engine.bindInboundResponseHandler(handler);
  }
}
