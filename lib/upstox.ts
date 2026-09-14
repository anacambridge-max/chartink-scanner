import type { Candle, Instrument } from "./types";

const API_BASE = "https://api.upstox.com";
const INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";

let instrumentCache: { expiresAt: number; instruments: Instrument[] } | null = null;
const previousDayCache = new Map<string, { expiresAt: number; candle: Candle | null }>();

// Upstox standard APIs allow 50 requests/sec and 500/min. Keep the queue at
// 8 requests/sec so a full scan remains safely inside the minute limit.
const API_MIN_INTERVAL_MS = 125;
let apiQueue: Promise<unknown> = Promise.resolve();
let nextApiSlot = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function scheduleApiRequest<T>(fn: () => Promise<T>): Promise<T> {
  const run = apiQueue.then(async () => {
    const wait = Math.max(0, nextApiSlot - Date.now());
    if (wait > 0) await sleep(wait);
    nextApiSlot = Date.now() + API_MIN_INTERVAL_MS;
    return fn();
  });
  apiQueue = run.then(() => undefined, () => undefined);
  return run;
}

function token(): string {
  const value = process.env.UPSTOX_ACCESS_TOKEN;
  if (!value) throw new Error("UPSTOX_ACCESS_TOKEN is not configured");
  return value;
}

async function upstoxGet<T>(path: string): Promise<T> {
  return scheduleApiRequest(async () => {
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token()}` },
        cache: "no-store",
      });
      if (response.ok) return response.json() as Promise<T>;
      const body = await response.text().catch(() => "");
      lastError = `Upstox ${response.status}: ${body.slice(0, 300)}`;
      if (response.status !== 429 || attempt === 3) throw new Error(lastError);
      await sleep(1500 * (attempt + 1));
    }
    throw new Error(lastError || "Upstox request failed");
  });
}

async function loadInstrumentFile(): Promise<Instrument[]> {
  const response = await fetch(INSTRUMENTS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to download Upstox NSE instrument master: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const { gunzipSync } = await import("node:zlib");
  return JSON.parse(gunzipSync(Buffer.from(arrayBuffer)).toString("utf8")) as Instrument[];
}

export async function getNseFnoStocks(): Promise<Instrument[]> {
  const ttl = Number(process.env.INSTRUMENT_CACHE_TTL_SECONDS ?? 86400) * 1000;
  if (instrumentCache && Date.now() < instrumentCache.expiresAt) return instrumentCache.instruments;
  const all = await loadInstrumentFile();
  const fnoUnderlyingKeys = new Set(
    all.filter((item) =>
      item.segment === "NSE_FO" &&
      ["FUT", "CE", "PE"].includes(item.instrument_type) &&
      item.underlying_type === "EQUITY" &&
      Boolean(item.underlying_key),
    ).map((item) => item.underlying_key as string),
  );
  const equities = all.filter((item) =>
    item.segment === "NSE_EQ" &&
    ["EQ", "BE"].includes(item.instrument_type) &&
    fnoUnderlyingKeys.has(item.instrument_key),
  );
  instrumentCache = { expiresAt: Date.now() + ttl, instruments: equities };
  return equities;
}

export async function getConfiguredUniverse(): Promise<Instrument[]> {
  return getNseFnoStocks();
}

interface CandleResponse { status: string; data?: { candles?: unknown[][] } }

function parseCandles(payload: CandleResponse): Candle[] {
  return (payload.data?.candles ?? []).map((row) => ({
    timestamp: String(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
    close: Number(row[4]), volume: Number(row[5]), oi: row[6] == null ? undefined : Number(row[6]),
  })).filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.volume));
}

export async function getIntradayCandles(instrumentKey: string, minutes: 1 | 3 | 5): Promise<Candle[]> {
  const encoded = encodeURIComponent(instrumentKey);
  const payload = await upstoxGet<CandleResponse>(`/v3/historical-candle/intraday/${encoded}/minutes/${minutes}`);
  return parseCandles(payload);
}

interface OhlcItem {
  instrument_token?: string;
  prev_ohlc?: { open: number; high: number; low: number; close: number; volume: number; ts: number };
}
interface OhlcResponse { status: string; data?: Record<string, OhlcItem> }

export async function getPreviousTradingDailyCandles(instrumentKeys: string[]): Promise<Map<string, Candle>> {
  const result = new Map<string, Candle>();
  const missing: string[] = [];
  const now = Date.now();
  for (const key of instrumentKeys) {
    const cached = previousDayCache.get(`${key}|batch`);
    if (cached && now < cached.expiresAt && cached.candle) result.set(key, cached.candle);
    else missing.push(key);
  }

  // OHLC V3 accepts up to 500 instrument keys in one request and returns the
  // previous trading session in prev_ohlc. This replaces one daily request per
  // stock with one request for the whole F&O chunk.
  for (let i = 0; i < missing.length; i += 500) {
    const batch = missing.slice(i, i + 500);
    const encoded = encodeURIComponent(batch.join(","));
    const payload = await upstoxGet<OhlcResponse>(`/v3/market-quote/ohlc?instrument_key=${encoded}&interval=1d`);
    for (const item of Object.values(payload.data ?? {})) {
      const key = item.instrument_token;
      const p = item.prev_ohlc;
      if (!key || !p) continue;
      const candle: Candle = {
        timestamp: new Date(p.ts).toISOString(),
        open: Number(p.open), high: Number(p.high), low: Number(p.low),
        close: Number(p.close), volume: Number(p.volume),
      };
      previousDayCache.set(`${key}|batch`, { expiresAt: now + 12 * 60 * 60 * 1000, candle });
      result.set(key, candle);
    }
  }
  return result;
}

export async function getPreviousTradingDailyCandle(instrumentKey: string, toDate: string, fromDate: string): Promise<Candle | null> {
  const cacheKey = `${instrumentKey}|${toDate}`;
  const cached = previousDayCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.candle;
  const encoded = encodeURIComponent(instrumentKey);
  const payload = await upstoxGet<CandleResponse>(`/v3/historical-candle/${encoded}/days/1/${toDate}/${fromDate}`);
  const candle = parseCandles(payload)
    .filter((c) => c.timestamp.slice(0, 10) < toDate)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null;
  previousDayCache.set(cacheKey, { expiresAt: Date.now() + 12 * 60 * 60 * 1000, candle });
  return candle;
}
