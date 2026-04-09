import type { WeatherProvider, WeatherResult } from "./realtime-tool-bridge.js";

/**
 * Fetches current weather from wttr.in (no API key required).
 * Uses the one-line format for a concise spoken response.
 */
export class WttrWeatherProvider implements WeatherProvider {
  private readonly location: string;
  private readonly timeoutMs: number;

  constructor(options: { location?: string; timeoutMs?: number } = {}) {
    this.location = options.location?.trim() || "";
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async getCurrent(): Promise<WeatherResult> {
    const loc = encodeURIComponent(this.location || "");
    // format=j1 returns JSON; we derive a spoken phrase from it
    const url = `https://wttr.in/${loc}?format=j1`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`wttr.in responded with ${response.status}`);
      }

      const json = (await response.json()) as WttrResponse;
      const current = json.current_condition?.[0];
      if (!current) {
        return { spoken: "Weather data unavailable right now." };
      }

      const tempF = current.temp_F;
      const desc = current.weatherDesc?.[0]?.value ?? "unknown conditions";
      const feelsF = current.FeelsLikeF;

      let spoken = `It's ${tempF}°F and ${desc.toLowerCase()}.`;
      if (feelsF && feelsF !== tempF) {
        spoken += ` Feels like ${feelsF}°F.`;
      }

      return { spoken };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return { spoken: "Weather request timed out, sorry." };
      }
      console.warn("[WttrWeatherProvider] fetch failed:", err);
      return { spoken: "Couldn\'t fetch weather right now." };
    } finally {
      clearTimeout(timer);
    }
  }
}

type WttrResponse = {
  current_condition?: Array<{
    temp_F?: string;
    FeelsLikeF?: string;
    weatherDesc?: Array<{ value?: string }>;
  }>;
};
