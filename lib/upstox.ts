import type { Candle, Instrument } from "./types";

const API_BASE = "https://api.upstox.com";
const INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";

let instrumentCache: { expiresAt: number; instruments: Instrument[]; bySymbol: Map<string, Instrument> } | null = null;

function token(): string {
  const value = process.env.UPSTOX_ACCESS_TOKEN;
  if (!value) throw new Error("UPSTOX_ACCESS_TOKEN is not configured");
  return value;
}

async function upstoxGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token()}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Upstox ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

async function loadInstrumentFile(): Promise<Instrument[]> {
  const response = await fetch(INSTRUMENTS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to download Upstox NSE instrument master: ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  const { gunzipSync } = await import("node:zlib");
  const text = gunzipSync(Buffer.from(arrayBuffer)).toString("utf8");
  return JSON.parse(text) as Instrument[];
}

export async function getNseEquities(): Promise<Instrument[]> {
  const ttl = Number(process.env.INSTRUMENT_CACHE_TTL_SECONDS ?? 86400) * 1000;
  if (instrumentCache && Date.now() < instrumentCache.expiresAt) return instrumentCache.instruments;

  const all = await loadInstrumentFile();
  const equities = all.filter((item) => item.segment === "NSE_EQ" && ["EQ", "BE"].includes(item.instrument_type));
  const bySymbol = new Map(equities.map((item) => [item.trading_symbol.toUpperCase(), item]));
  instrumentCache = { expiresAt: Date.now() + ttl, instruments: equities, bySymbol };
  return equities;
}

export async function getConfiguredUniverse(): Promise<Instrument[]> {
  const all = await getNseEquities();
  const configured = process.env.NSE_SYMBOLS?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!configured?.length) return all;
  const map = new Map(all.map((item) => [item.trading_symbol.toUpperCase(), item]));
  return configured.map((symbol) => map.get(symbol)).filter((x): x is Instrument => Boolean(x));
}

interface CandleResponse { status: string; data?: { candles?: unknown[][] } }

function parseCandles(payload: CandleResponse): Candle[] {
  return (payload.data?.candles ?? []).map((row) => ({
    timestamp: String(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    oi: row[6] == null ? undefined : Number(row[6]),
  })).filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.volume));
}

export async function getIntradayCandles(instrumentKey: string, minutes: 1 | 3 | 5): Promise<Candle[]> {
  const encoded = encodeURIComponent(instrumentKey);
  const payload = await upstoxGet<CandleResponse>(`/v3/historical-candle/intraday/${encoded}/minutes/${minutes}`);
  return parseCandles(payload);
}

export async function getPreviousDayDailyCandle(instrumentKey: string, tradingDate: string): Promise<Candle | null> {
  const encoded = encodeURIComponent(instrumentKey);
  const payload = await upstoxGet<CandleResponse>(`/v3/historical-candle/${encoded}/days/1/${tradingDate}`);
  const candles = parseCandles(payload);
  return candles.at(0) ?? null;
}

export async function getPreviousTradingDailyCandle(instrumentKey: string, fromDate: string, previousDate: string): Promise<Candle | null> {
  const encoded = encodeURIComponent(instrumentKey);
  const payload = await upstoxGet<CandleResponse>(`/v3/historical-candle/${encoded}/days/1/${fromDate}/${previousDate}`);
  const candles = parseCandles(payload).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return candles.at(0) ?? null;
}
