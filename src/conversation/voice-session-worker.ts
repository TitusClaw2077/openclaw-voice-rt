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
  onEscalate?: (callId: string, task: string) => void;
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
const ESCALATION_INSTRUCTION =
  ' If the user asks for something that requires a tool, lookup, or external action (e.g. check, look up, search, find, send, set, create, schedule, remind, weather, calendar, email), respond ONLY with valid JSON: {"escalate":true,"spoken":"Sure, let me check on that for you.","task":"brief task description"}. Otherwise respond with normal conversational text.';

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
  private readonly _onEscalate?: (callId: string, task: string) => void;
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
    this._onEscalate = opts.onEscalate;
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
    const base = this._config.responseSystemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
    return [
      {
        role: "system",
        content: base + ESCALATION_INSTRUCTION,
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

      const escalation = this._tryParseEscalation(text);

      this._setState("speaking");

      if (escalation) {
        const spoken = escalation.spoken?.trim() || "Let me look into that.";
        await this._speak(spoken);

        if (this._isStaleGeneration(generationVersion, controller)) {
          return;
        }

        this._appendHistory("assistant", spoken);
        this._generationController = null;
        this._setState("listening");
        this._onEscalate?.(this.callId, escalation.task ?? "");
      } else {
        await this._speak(text);

        if (this._isStaleGeneration(generationVersion, controller)) {
          return;
        }

        this._appendHistory("assistant", text);
        this._generationController = null;
        this._setState("listening");
      }
    } catch (error) {
      if (this._isStaleGeneration(generationVersion, controller)) {
        return;
      }

      this._generationController = null;
      console.error(`[VoiceSessionWorker:${this.callId}]`, error);
      this._setState("listening");
    }
  }

  private _tryParseEscalation(
    text: string,
  ): { escalate: true; spoken?: string; task?: string } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed) as { escalate?: unknown; spoken?: unknown; task?: unknown };
      if (parsed.escalate === true) {
        return {
          escalate: true,
          spoken: typeof parsed.spoken === "string" ? parsed.spoken : undefined,
          task: typeof parsed.task === "string" ? parsed.task : undefined,
        };
      }
    } catch {
      // not valid JSON — treat as plain text
    }

    return null;
  }

  private async _speak(text: string): Promise<void> {
    const result = await this._manager.speak(this.callId, text);
    if (!result.success) {
      throw new Error(result.error ?? `Failed to speak on call ${this.callId}`);
    }
  }
}
