export type RealtimeToolRequest = {
  transcript: string;
  signal?: AbortSignal;
};

export type RealtimeToolResult = {
  spoken: string;
};

export interface RealtimeToolBridge {
  handle(request: RealtimeToolRequest): Promise<RealtimeToolResult | null>;
}

type TimeDayIntent = {
  wantsTime: boolean;
  wantsDay: boolean;
};

type MinimalRealtimeToolBridgeOptions = {
  locale?: string;
  now?: () => Date;
  timeZone?: string;
};

export class MinimalRealtimeToolBridge implements RealtimeToolBridge {
  private readonly locale: string;
  private readonly now: () => Date;
  private readonly timeZone: string;

  constructor(options: MinimalRealtimeToolBridgeOptions = {}) {
    this.locale = options.locale ?? "en-US";
    this.now = options.now ?? (() => new Date());
    this.timeZone =
      options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  }

  async handle(request: RealtimeToolRequest): Promise<RealtimeToolResult | null> {
    const intent = detectTimeDayIntent(request.transcript);
    if (!intent) {
      return null;
    }

    return { spoken: this.formatTimeDay(intent) };
  }

  private formatTimeDay(intent: TimeDayIntent): string {
    const now = this.now();

    if (intent.wantsTime && intent.wantsDay) {
      const day = new Intl.DateTimeFormat(this.locale, {
        weekday: "long",
        timeZone: this.timeZone,
      }).format(now);
      const time = new Intl.DateTimeFormat(this.locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: this.timeZone,
        timeZoneName: "short",
      }).format(now);
      return `It's ${day}, ${time}.`;
    }

    if (intent.wantsDay) {
      const day = new Intl.DateTimeFormat(this.locale, {
        weekday: "long",
        timeZone: this.timeZone,
      }).format(now);
      return `Today is ${day}.`;
    }

    const time = new Intl.DateTimeFormat(this.locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: this.timeZone,
      timeZoneName: "short",
    }).format(now);
    return `It's ${time}.`;
  }
}

function detectTimeDayIntent(transcript: string): TimeDayIntent | null {
  const normalized = normalizeForIntent(transcript);
  const wantsTime =
    normalized === "time" ||
    /\bwhat time is it\b/.test(normalized) ||
    /\bwhat is the time\b/.test(normalized) ||
    /\bwhat s the time\b/.test(normalized) ||
    /\bcurrent time\b/.test(normalized) ||
    /\btime now\b/.test(normalized);
  const wantsDay =
    normalized === "day" ||
    normalized === "day of week" ||
    normalized === "day of the week" ||
    /\bwhat day is it\b/.test(normalized) ||
    /\bwhat day of the week is it\b/.test(normalized) ||
    /\bwhat is today s day\b/.test(normalized) ||
    /\bwhat s today s day\b/.test(normalized);

  if (!wantsTime && !wantsDay) {
    return null;
  }

  if (/\b(?:time|day)\b.*\bin\b/.test(normalized)) {
    return null;
  }

  return {
    wantsTime,
    wantsDay,
  };
}

function normalizeForIntent(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
