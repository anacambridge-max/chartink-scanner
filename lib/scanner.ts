import type { Candle, Direction, Instrument, ScannerMatch, Timeframe } from "./types";
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

function previousBusinessDateIso(date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  do d.setDate(d.getDate() - 1); while ([0, 6].includes(d.getDay()));
  return d.toISOString().slice(0, 10);
}

function currentDateIso(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

async function fetchSymbolData(instrument: Instrument, timeframe: Timeframe) {
  const now = new Date();
  const currentDate = currentDateIso(now);
  const previousDate = previousBusinessDateIso(now);
  const [candles, previous] = await Promise.all([
    getIntradayCandles(instrument.instrument_key, timeframe),
    getPreviousTradingDailyCandle(instrument.instrument_key, currentDate, previousDate),
  ]);

  return { candles, previous, currentDate };
}

export async function scanInstrument(
  instrument: Instrument,
  timeframe: Timeframe,
  multiplier: number,
  priceThreshold: number,
): Promise<ScannerMatch[]> {
  const { candles, previous } = await fetchSymbolData(instrument, timeframe);
  if (!candles.length || !previous) return [];

  const previousDayHigh = previous.high;
  const previousDayLow = previous.low;
  // Daily High > threshold means the highest price of today's daily candle.
  // Intraday candles are sufficient to derive today's running daily high.
  const dailyHigh = Math.max(...candles.map((c) => c.high));
  if (!(dailyHigh > priceThreshold)) return [];

  // Use the most recent available candle as Chartink-style "current" candle.
  const current = candles.at(-1)!;
  const volumeHistory = candles.slice(-21, -1).map((c) => c.volume);
  if (volumeHistory.length < 20) return [];
  const sma20Volume = sma(volumeHistory);
  if (!(sma20Volume > 0)) return [];

  const volumeMultiple = current.volume / sma20Volume;
  if (!(current.volume > sma20Volume * multiplier)) return [];

  const matches: ScannerMatch[] = [];
  const base = {
    symbol: instrument.trading_symbol,
    instrumentKey: instrument.instrument_key,
    ltp: current.close,
    volumeMultiple,
    currentVolume: current.volume,
    sma20Volume,
    prevDayHigh: previousDayHigh,
    prevDayLow: previousDayLow,
    dailyHigh,
    triggerTime: current.timestamp,
    timeframe,
  };

  if (current.high > previousDayHigh) matches.push({ ...base, direction: "BULLISH BREAKOUT" });
  if (current.low < previousDayLow) matches.push({ ...base, direction: "BEARISH BREAKDOWN" });
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
