import type { VoiceCallConfig } from "../config.js";
import type { CallManager } from "../manager.js";

export type WorkerState = "idle" | "listening" | "generating" | "speaking" | "interrupted" | "ended";

export interface VoiceSessionWorkerOptions {
  callId: string;
  config: VoiceCallConfig;
  manager: CallManager;
  openaiApiKey: string;
  model?: string;
  onStateChange?: (state: WorkerState) => void;
}

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
};

const MAX_HISTORY_TURNS = 20;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_SYSTEM_PROMPT = "You are a concise, conversational voice assistant on a phone call.";

function pickModelRef(configModel: string | undefined, optionModel: string | undefined): string {
  if (configModel?.trim()) {
    return configModel;
  }

  if (optionModel?.trim()) {
    return optionModel;
  }

  return "gpt-4o-mini";
}

function resolveModelName(modelRef: string | undefined): string {
  const value = modelRef?.trim();
  if (!value) {
    return "gpt-4o-mini";
  }

  const slashIndex = value.indexOf("/");
  return slashIndex >= 0 ? value.slice(slashIndex + 1) : value;
}

function extractAssistantText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

export class VoiceSessionWorker {
  readonly callId: string;

  private _state: WorkerState = "idle";
  private readonly _config: VoiceCallConfig;
  private readonly _manager: CallManager;
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _onStateChange?: (state: WorkerState) => void;
  private _history: ChatMessage[] = [];
  private _generationController: AbortController | null = null;
  private _generationVersion = 0;

  get state(): WorkerState {
    return this._state;
  }

  constructor(opts: VoiceSessionWorkerOptions) {
    this.callId = opts.callId;
    this._config = opts.config;
    this._manager = opts.manager;
    this._apiKey = opts.openaiApiKey;
    this._model = resolveModelName(pickModelRef(opts.config.responseModel, opts.model));
    this._onStateChange = opts.onStateChange;
    this._setState("listening");
  }

  handleTranscript(text: string): void {
    const normalizedText = text.trim();
    if (!normalizedText || this._state === "ended") {
      return;
    }

    this._cancelGeneration();
    this._appendHistory("user", normalizedText);
    this._setState("generating");

    const controller = new AbortController();
    const generationVersion = ++this._generationVersion;
    this._generationController = controller;

    void this._generateReply(generationVersion, controller);
  }

  interrupt(): void {
    if (this._state === "ended") {
      return;
    }

    this._cancelGeneration();
    this._setState("interrupted");
    this._setState("listening");
  }

  async speakDirect(text: string): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText || this._state === "ended") {
      return;
    }

    this._cancelGeneration();
    this._setState("speaking");

    try {
      await this._speak(normalizedText);
      this._appendHistory("assistant", normalizedText);
    } finally {
      if (this._state !== "ended") {
        this._setState("listening");
      }
    }
  }

  dispose(): void {
    this._cancelGeneration();
    this._setState("ended");
  }

  private _setState(state: WorkerState): void {
    if (this._state === state) {
      return;
    }

    this._state = state;
    this._onStateChange?.(state);
  }

  private _cancelGeneration(): void {
    this._generationController?.abort();
    this._generationController = null;
  }

  private _appendHistory(role: Exclude<ChatRole, "system">, content: string): void {
    this._history.push({ role, content });

    if (this._history.length > MAX_HISTORY_TURNS) {
      this._history = this._history.slice(-MAX_HISTORY_TURNS);
    }
  }

  private _buildMessages(): ChatMessage[] {
    return [
      {
        role: "system",
        content: this._config.responseSystemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
      },
      ...this._history,
    ];
  }

  private _isStaleGeneration(generationVersion: number, controller: AbortController): boolean {
    return (
      controller.signal.aborted ||
      this._state === "ended" ||
      generationVersion !== this._generationVersion
    );
  }

  private async _generateReply(
    generationVersion: number,
    controller: AbortController,
  ): Promise<void> {
    try {
      const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this._apiKey}`,
        },
        body: JSON.stringify({
          model: this._model,
          messages: this._buildMessages(),
        }),
        signal: controller.signal,
      });

      if (this._isStaleGeneration(generationVersion, controller)) {
        return;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`OpenAI API error ${response.status}${body ? `: ${body}` : ""}`);
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const text = extractAssistantText(payload);

      if (this._isStaleGeneration(generationVersion, controller)) {
        return;
      }

      if (!text) {
        throw new Error("OpenAI response was empty");
      }

      this._setState("speaking");
      await this._speak(text);

      if (this._isStaleGeneration(generationVersion, controller)) {
        return;
      }

      this._appendHistory("assistant", text);
      this._generationController = null;
      this._setState("listening");
    } catch (error) {
      if (this._isStaleGeneration(generationVersion, controller)) {
        return;
      }

      this._generationController = null;
      console.error(`[VoiceSessionWorker:${this.callId}]`, error);
      this._setState("listening");
    }
  }

  private async _speak(text: string): Promise<void> {
    const result = await this._manager.speak(this.callId, text);
    if (!result.success) {
      throw new Error(result.error ?? `Failed to speak on call ${this.callId}`);
    }
  }
}
