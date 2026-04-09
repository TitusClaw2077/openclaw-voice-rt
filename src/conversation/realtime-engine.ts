import { VoiceSessionWorker, type VoiceSessionWorkerOptions } from "./voice-session-worker.js";
import { MinimalRealtimeToolBridge } from "./realtime-tool-bridge.js";
import { WttrWeatherProvider } from "./wttr-weather-provider.js";
import type { ConversationEngine } from "./base.js";
import type { VoiceCallConfig } from "../config.js";
import type { CoreConfig } from "../core-bridge.js";
import type { CallManager } from "../manager.js";
import type { CallRecord } from "../types.js";

export class RealtimeEngine implements ConversationEngine {
  private readonly config: VoiceCallConfig;
  private readonly manager: CallManager;
  private readonly coreConfig: CoreConfig; // reserved for future tool use in M4
  private readonly fallbackToLegacy = false;
  private readonly workers = new Map<string, VoiceSessionWorker>();

  constructor(
    config: VoiceCallConfig,
    deps: { manager: CallManager; coreConfig: CoreConfig },
  ) {
    this.config = config;
    this.manager = deps.manager;
    this.coreConfig = deps.coreConfig;
    this.fallbackToLegacy = !config.streaming.enabled;
  }

  async onCallConnected(call: CallRecord): Promise<void> {
    const existingWorker = this.workers.get(call.callId);
    if (existingWorker) {
      existingWorker.dispose();
    }

    try {
      const openaiApiKey =
        this.config.streaming.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
      if (!openaiApiKey) {
        throw new Error("OPENAI_API_KEY is required");
      }

      const location =
        typeof (this.config as Record<string, unknown>).weatherLocation === "string"
          ? (this.config as unknown as { weatherLocation?: string }).weatherLocation?.trim()
          : undefined;
      const weatherProvider = new WttrWeatherProvider({ location });
      const toolBridge = new MinimalRealtimeToolBridge({ weatherProvider });

      const workerOptions: VoiceSessionWorkerOptions = {
        callId: call.callId,
        config: this.config,
        manager: this.manager,
        openaiApiKey,
        toolBridge,
        onEscalate: (callId: string, task: string) => {
          console.log(`[RealtimeEngine] escalating task for callId ${callId}: ${task}`);
        },
      };

      const worker = new VoiceSessionWorker(workerOptions);
      this.workers.set(call.callId, worker);
      console.log(`[RealtimeEngine] worker created for callId ${call.callId}`);
    } catch (err) {
      console.error(
        `[RealtimeEngine] failed to create worker for callId ${call.callId}: ${String(err)}`,
      );
      if (!this.fallbackToLegacy) {
        this.handleWorkerError(call.callId, err);
      }
    }
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
      console.warn(`[RealtimeEngine] no worker for callId ${callId}, transcript dropped`);
      return;
    }

    if (worker.state === "ended") {
      console.warn(`[RealtimeEngine] worker ended for callId ${callId}, transcript dropped`);
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

  private handleWorkerError(callId: string, err: unknown): void {
    console.error(`[RealtimeEngine] worker error for callId ${callId}: ${String(err)}`);
    void this.manager.endCall(callId).catch((endErr) => {
      console.error(
        `[RealtimeEngine] failed to end callId ${callId} after worker error: ${String(endErr)}`,
      );
    });
  }
}
