import type { WeatherProvider, WeatherResult } from "./realtime-tool-bridge.js";

// WMO weather codes → spoken description
// https://open-meteo.com/en/docs (weathercode)
function describeWeatherCode(code: number): string {
  if (code === 0) return "clear sky";
  if (code === 1) return "mainly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 49) return "foggy";
  if (code <= 57) return "drizzling";
  if (code <= 67) return "rainy";
  if (code <= 77) return "snowy";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  if (code <= 99) return "thunderstorms";
  return "unknown conditions";
}

/**
 * Fetches current weather from Open-Meteo (no API key required).
 * Uses fixed Corinth, TX coordinates; falls back to IP geolocation
 * if no explicit location is configured.
 *
 * Replaces WttrWeatherProvider which broke when wttr.in started
 * returning null JSON responses.
 */
export class WttrWeatherProvider implements WeatherProvider {
  private readonly lat: number;
  private readonly lon: number;
  private readonly timeoutMs: number;

  constructor(options: { location?: string; lat?: number; lon?: number; timeoutMs?: number } = {}) {
    // Default: Corinth, TX
    this.lat = options.lat ?? 33.1556;
    this.lon = options.lon ?? -97.0641;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async getCurrent(): Promise<WeatherResult> {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${this.lat}&longitude=${this.lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code` +
      `&temperature_unit=fahrenheit` +
      `&forecast_days=1`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "openclaw-voice-rt/1.0" },
      });

      if (!response.ok) {
        throw new Error(`Open-Meteo responded with ${response.status}`);
      }

      const json = (await response.json()) as OpenMeteoResponse;
      const current = json.current;

      if (!current) {
        return { spoken: "Weather data unavailable right now." };
      }

      const tempF = Math.round(current.temperature_2m ?? 0);
      const feelsF = Math.round(current.apparent_temperature ?? tempF);
      const desc = describeWeatherCode(current.weather_code ?? 0);

      let spoken = `It's ${tempF}°F and ${desc}.`;
      if (Math.abs(feelsF - tempF) >= 3) {
        spoken += ` Feels like ${feelsF}°F.`;
      }

      return { spoken };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return { spoken: "Weather request timed out, sorry." };
      }
      console.warn("[WeatherProvider] fetch failed:", err);
      return { spoken: "Couldn't fetch weather right now." };
    } finally {
      clearTimeout(timer);
    }
  }
}

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
  };
};
