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

export type WeatherResult = {
  spoken: string;
};

export interface WeatherProvider {
  getCurrent(): Promise<WeatherResult>;
}

class UnavailableWeatherProvider implements WeatherProvider {
  async getCurrent(): Promise<WeatherResult> {
    return { spoken: "I don't have weather access right now, sorry." };
  }
}

type TimeDayIntent = {
  wantsTime: boolean;
  wantsDay: boolean;
  wantsDate: boolean;
  wantsTomorrow: boolean;
};

type MinimalRealtimeToolBridgeOptions = {
  locale?: string;
  now?: () => Date;
  timeZone?: string;
  weatherProvider?: WeatherProvider;
};

export class MinimalRealtimeToolBridge implements RealtimeToolBridge {
  private readonly locale: string;
  private readonly now: () => Date;
  private readonly timeZone: string;
  private readonly _weatherProvider: WeatherProvider;

  constructor(options: MinimalRealtimeToolBridgeOptions = {}) {
    this.locale = options.locale ?? "en-US";
    this.now = options.now ?? (() => new Date());
    this.timeZone =
      options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    this._weatherProvider = options.weatherProvider ?? new UnavailableWeatherProvider();
  }

  async handle(request: RealtimeToolRequest): Promise<RealtimeToolResult | null> {
    const timeIntent = detectTimeDayIntent(request.transcript);
    if (timeIntent) {
      return { spoken: this.formatTimeDay(timeIntent) };
    }

    if (isWeatherQuery(request.transcript)) {
      const result = await this._weatherProvider.getCurrent();
      return { spoken: result.spoken };
    }

    return null;
  }

  private formatTimeDay(intent: TimeDayIntent): string {
    const now = this.now();
    const targetDate = intent.wantsTomorrow ? addDays(now, 1) : now;

    if (intent.wantsTime && intent.wantsDay) {
      return `It's ${this.formatWeekday(targetDate)}, ${this.formatTime(now)}.`;
    }

    if (intent.wantsDate && intent.wantsTomorrow) {
      return `Tomorrow is ${this.formatFullDate(targetDate)}.`;
    }

    if (intent.wantsDate) {
      return `Today is ${this.formatFullDate(targetDate)}.`;
    }

    if (intent.wantsDay && intent.wantsTomorrow) {
      return `Tomorrow is ${this.formatWeekday(targetDate)}.`;
    }

    if (intent.wantsDay) {
      return `Today is ${this.formatWeekday(targetDate)}.`;
    }

    return `It's ${this.formatTime(now)}.`;
  }

  private formatWeekday(date: Date): string {
    return new Intl.DateTimeFormat(this.locale, {
      weekday: "long",
      timeZone: this.timeZone,
    }).format(date);
  }

  private formatTime(date: Date): string {
    return new Intl.DateTimeFormat(this.locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: this.timeZone,
      timeZoneName: "short",
    }).format(date);
  }

  private formatFullDate(date: Date): string {
    const parts = new Intl.DateTimeFormat(this.locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: this.timeZone,
    }).formatToParts(date);

    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const dayValue = Number(parts.find((part) => part.type === "day")?.value ?? "0");
    const year = parts.find((part) => part.type === "year")?.value ?? "";

    return `${weekday}, ${month} ${dayValue}${ordinalSuffix(dayValue)}, ${year}`;
  }
}

function ordinalSuffix(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return "th";
  }

  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
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
    /\bwhat s today s day\b/.test(normalized) ||
    /\bwhat s the day\b/.test(normalized) ||
    /\bwhat is the day\b/.test(normalized);
  const wantsDate =
    normalized === "date" ||
    /\bwhat s the date\b/.test(normalized) ||
    /\bwhat is the date\b/.test(normalized) ||
    /\bwhat s today s date\b/.test(normalized) ||
    /\bwhat is today s date\b/.test(normalized) ||
    /\btoday s date\b/.test(normalized);
  const wantsTomorrow =
    normalized === "tomorrow" ||
    /\bwhat s tomorrow\b/.test(normalized) ||
    /\bwhat is tomorrow\b/.test(normalized) ||
    /\bwhat day is tomorrow\b/.test(normalized) ||
    /\bwhat s tomorrow s date\b/.test(normalized) ||
    /\bwhat is tomorrow s date\b/.test(normalized);

  if (!wantsTime && !wantsDay && !wantsDate && !wantsTomorrow) {
    return null;
  }

  if (/\b(?:time|day|date)\b.*\bin\b/.test(normalized)) {
    return null;
  }

  return {
    wantsTime,
    wantsDay: wantsDay || wantsTomorrow,
    wantsDate,
    wantsTomorrow,
  };
}

function isWeatherQuery(transcript: string): boolean {
  const normalized = normalizeForIntent(transcript);
  return (
    /\bweather\b/.test(normalized) ||
    /\btemperature\b/.test(normalized) ||
    /\bhow (hot|cold|warm|cool|humid) is it\b/.test(normalized) ||
    /\bwhat is it like outside\b/.test(normalized) ||
    /\bhow s it outside\b/.test(normalized)
  );
}

function normalizeForIntent(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
