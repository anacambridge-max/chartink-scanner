import type { Instrument, ScannerMatch, Timeframe } from "./types";
import { getIntradayCandles, getPreviousTradingDailyCandle } from "./upstox";

function sma(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function marketHoursLikelyOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const day = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const total = hour * 60 + minute;
  return !["Sat", "Sun"].includes(day ?? "") && total >= 555 && total <= 930;
}

function isoIndia(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

function previousCalendarDateIso(date = new Date(), days = 1): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return isoIndia(d);
}

async function fetchPreviousTradingCandle(instrumentKey: string, now: Date) {
  const currentDate = isoIndia(now);
  const fromDate = previousCalendarDateIso(now, 10);
  return getPreviousTradingDailyCandle(instrumentKey, currentDate, fromDate);
}

export async function scanInstrument(
  instrument: Instrument,
  timeframe: Timeframe,
  multiplier: number,
  priceThreshold: number,
): Promise<ScannerMatch[]> {
  // IMPORTANT: do not fetch the previous-day candle for every stock upfront.
  // First use the single intraday request to eliminate stocks that fail the
  // cheap daily-high / volume conditions. Only likely matches need the second
  // historical request for previous-day High/Low.
  const candles = await getIntradayCandles(instrument.instrument_key, timeframe);
  if (!candles.length) return [];

  const dailyHigh = Math.max(...candles.map((c) => c.high));
  if (!(dailyHigh > priceThreshold)) return [];

  const current = candles.at(-1)!;
  const volumeHistory = candles.slice(-21, -1).map((c) => c.volume);
  if (volumeHistory.length < 20) return [];
  const sma20Volume = sma(volumeHistory);
  if (!(sma20Volume > 0)) return [];

  const volumeMultiple = current.volume / sma20Volume;
  if (!(current.volume > sma20Volume * multiplier)) return [];

  // Only now make the relatively expensive historical request.
  const previous = await fetchPreviousTradingCandle(instrument.instrument_key, new Date());
  if (!previous) return [];

  const base = {
    symbol: instrument.trading_symbol,
    instrumentKey: instrument.instrument_key,
    ltp: current.close,
    volumeMultiple,
    currentVolume: current.volume,
    sma20Volume,
    prevDayHigh: previous.high,
    prevDayLow: previous.low,
    dailyHigh,
    triggerTime: current.timestamp,
    timeframe,
  };

  const matches: ScannerMatch[] = [];
  if (current.high > previous.high) matches.push({ ...base, direction: "BULLISH BREAKOUT" });
  if (current.low < previous.low) matches.push({ ...base, direction: "BEARISH BREAKDOWN" });
  return matches;
}

export function validateScannerInputs(searchParams: URLSearchParams) {
  const timeframeValue = Number(searchParams.get("timeframe") ?? 1);
  const multiplier = Number(searchParams.get("multiplier") ?? 2);
  const priceThreshold = Number(searchParams.get("priceThreshold") ?? 50);
  if (![1, 3, 5].includes(timeframeValue)) throw new Error("timeframe must be 1, 3, or 5");
  if (![1.5, 2, 3, 4].includes(multiplier)) throw new Error("multiplier must be 1.5, 2, 3, or 4");
  if (!Number.isFinite(priceThreshold) || priceThreshold < 0) throw new Error("priceThreshold must be a non-negative number");
  return { timeframe: timeframeValue as Timeframe, multiplier, priceThreshold };
}
