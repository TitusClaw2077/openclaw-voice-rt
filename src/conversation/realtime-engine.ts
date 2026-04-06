import { VoiceSessionWorker, type VoiceSessionWorkerOptions } from "./voice-session-worker.js";
import type { ConversationEngine } from "./base.js";
import type { VoiceCallConfig } from "../config.js";
import type { CoreConfig } from "../core-bridge.js";
import type { CallManager } from "../manager.js";
import type { CallRecord } from "../types.js";

export class RealtimeEngine implements ConversationEngine {
  private readonly config: VoiceCallConfig;
  private readonly manager: CallManager;
  private readonly coreConfig: CoreConfig;
  private readonly workers = new Map<string, VoiceSessionWorker>();

  constructor(
    config: VoiceCallConfig,
    deps: { manager: CallManager; coreConfig: CoreConfig },
  ) {
    this.config = config;
    this.manager = deps.manager;
    this.coreConfig = deps.coreConfig;
  }

  async onCallConnected(call: CallRecord): Promise<void> {
    const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY is required");
    }

    const workerOptions: VoiceSessionWorkerOptions = {
      callId: call.callId,
      config: this.config,
      manager: this.manager,
      openaiApiKey,
    };

    const existingWorker = this.workers.get(call.callId);
    if (existingWorker) {
      existingWorker.dispose();
    }

    const worker = new VoiceSessionWorker(workerOptions);
    this.workers.set(call.callId, worker);
    console.log(`[RealtimeEngine] worker created for callId ${call.callId}`);

    void this.coreConfig;
  }

  onSpeechStart(callId: string): void {
    const worker = this.workers.get(callId);
    if (worker) {
      worker.interrupt();
    }
  }

  async onFinalTranscript(callId: string, text: string): Promise<void> {
    const worker = this.workers.get(callId);
    if (!worker) {
      console.warn(`[RealtimeEngine] worker not found for callId ${callId}`);
      return;
    }

    worker.handleTranscript(text);
  }

  async speak(callId: string, text: string, _opts?: { interrupt?: boolean }): Promise<void> {
    const worker = this.workers.get(callId);
    if (!worker) {
      console.warn(`[RealtimeEngine] worker not found for callId ${callId}`);
      return;
    }

    await worker.speakDirect(text);
  }

  interrupt(callId: string): void {
    const worker = this.workers.get(callId);
    if (worker) {
      worker.interrupt();
    }
  }

  async onCallEnded(callId: string): Promise<void> {
    const worker = this.workers.get(callId);
    if (worker) {
      worker.dispose();
      this.workers.delete(callId);
      console.log(`[RealtimeEngine] worker disposed for callId ${callId}`);
      return;
    }

    this.workers.delete(callId);
  }
}
