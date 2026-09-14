"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScanResponse, ScannerMatch, Timeframe } from "@/lib/types";

const refreshOptions = [15000, 30000, 60000] as const;
const multipliers = [1.5, 2, 3, 4] as const;
const CHUNK_SIZE = 100;

function formatNumber(value: number, decimals = 2) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: decimals }).format(value);
}
function formatTime(value: string) {
  try { return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }
  catch { return value; }
}
function formatVolume(value: number) {
  if (value >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (value >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} K`;
  return formatNumber(value, 0);
}

export default function Home() {
  const [timeframe, setTimeframe] = useState<Timeframe>(1);
  const [multiplier, setMultiplier] = useState<number>(2);
  const [priceThreshold, setPriceThreshold] = useState<number>(50);
  const [refreshMs, setRefreshMs] = useState<number>(30000);
  const [data, setData] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);

  const runScan = useCallback(async () => {
    if (loadingRef.current) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    loadingRef.current = true;
    setLoading(true);
    setProgress(0);
    setError("");
    setData(null);
    const started = Date.now();
    const allResults: ScannerMatch[] = [];
    let totalUniverse = 0;
    let scanned = 0;
    const warnings: string[] = [];
    let lastCompletedAt = new Date().toISOString();
    let marketLikelyOpen = true;

    try {
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams({
          timeframe: String(timeframe),
          multiplier: String(multiplier),
          priceThreshold: String(priceThreshold),
          offset: String(offset),
          limit: String(CHUNK_SIZE),
        });
        const response = await fetch(`/api/scan?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const json = await response.json() as ScanResponse & { error?: string };
        if (!response.ok || !json.ok) throw new Error(json.error ?? "Scanner request failed");

        totalUniverse = json.totalUniverse ?? totalUniverse;
        scanned += json.scanned;
        allResults.push(...(json.results ?? []));
        warnings.push(...(json.warnings ?? []));
        lastCompletedAt = json.completedAt;
        marketLikelyOpen = json.marketLikelyOpen;
        hasMore = Boolean(json.hasMore);
        offset += json.limit ?? CHUNK_SIZE;
        setProgress(totalUniverse ? Math.min(scanned, totalUniverse) : scanned);

        setData({
          ok: true,
          scanned,
          matched: allResults.length,
          totalUniverse,
          timeframe,
          volumeMultiplier: multiplier,
          priceThreshold,
          startedAt: new Date(started).toISOString(),
          completedAt: lastCompletedAt,
          elapsedMs: Date.now() - started,
          marketLikelyOpen,
          warnings: warnings.slice(0, 50),
          results: [...allResults].sort((a, b) => b.volumeMultiple - a.volumeMultiple),
        });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Scanner request failed");
    } finally {
      if (!controller.signal.aborted) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [timeframe, multiplier, priceThreshold]);

  useEffect(() => { void runScan(); }, [runScan]);
  useEffect(() => {
    const id = window.setInterval(() => {
      // Never abort a full-universe scan just because the refresh timer fired.
      // Start the next refresh only after the current scan has finished.
      if (!loadingRef.current) void runScan();
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [runScan, refreshMs]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const grouped = useMemo(() => data?.results ?? [], [data]);
  const bullish = grouped.filter((r) => r.direction === "BULLISH BREAKOUT").length;
  const bearish = grouped.filter((r) => r.direction === "BEARISH BREAKDOWN").length;
  const progressText = data?.totalUniverse ? `Scanning ${progress}/${data.totalUniverse}` : "Scanning…";

  return (
    <main className="min-h-screen bg-[#070b13] px-4 py-5 text-slate-100 md:px-7">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-400">UPSTOX · REAL-TIME F&O STOCK SCANNER</div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Chartink-Style F&O Breakout Scanner</h1>
            <p className="mt-1 text-sm text-slate-400">Only NSE F&O stocks are scanned · Volume SMA(20) × multiplier + previous-day High/Low breakout + Daily High threshold</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-full ${loading ? "animate-pulse bg-amber-400" : error ? "bg-red-500" : "bg-emerald-400"}`} />
            {loading ? progressText : error ? "Scanner error" : data?.marketLikelyOpen ? "Market hours" : "Outside market hours"}
          </div>
        </header>

        <section className="mb-5 grid gap-3 rounded-2xl border border-slate-800 bg-[#0b1220] p-3 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">Timeframe</label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900 p-1">
              {[1,3,5].map((value) => (
                <button key={value} onClick={() => setTimeframe(value as Timeframe)} className={`rounded-md px-3 py-2 text-sm font-semibold transition ${timeframe === value ? "bg-sky-500 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}>{value}m</button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-slate-400">Volume multiplier</label>
            <select value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-sky-500">
              {multipliers.map((value) => <option key={value} value={value}>{value}× SMA(20)</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-slate-400">Daily High &gt;</label>
            <input type="number" min="0" value={priceThreshold} onChange={(e) => setPriceThreshold(Number(e.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-sky-500" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-slate-400">Auto refresh</label>
            <select value={refreshMs} onChange={(e) => setRefreshMs(Number(e.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-sky-500">
              {refreshOptions.map((value) => <option key={value} value={value}>{value / 1000}s</option>)}
            </select>
          </div>

          <div className="flex items-end">
            <button onClick={() => void runScan()} disabled={loading} className="w-full rounded-lg bg-slate-700 px-3 py-2.5 text-sm font-semibold hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50">{loading ? progressText : "Scan Now"}</button>
          </div>
        </section>

        {error && <div className="mb-4 rounded-xl border border-red-900/70 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

        <section className="mb-4 grid gap-3 sm:grid-cols-4">
          {[
            ["F&O stocks scanned", data?.totalUniverse ? `${data.scanned}/${data.totalUniverse}` : data?.scanned ?? "—"],
            ["Bullish", bullish],
            ["Bearish", bearish],
            ["Scan time", data ? `${(data.elapsedMs / 1000).toFixed(1)}s` : "—"],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-800 bg-[#0b1220] px-4 py-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-bold">{value}</div></div>)}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0b1220] shadow-2xl shadow-black/10">
          <div className="flex flex-col gap-1 border-b border-slate-800 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-semibold">Matched F&O Stocks <span className="text-slate-500">({data?.matched ?? 0})</span></div>
            <div className="text-xs text-slate-500">Last completed: {data ? formatTime(data.completedAt) : "—"} IST</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1050px] w-full text-left text-sm">
              <thead className="bg-slate-900/70 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>{["Symbol", "LTP", "Volume Multiple", "Direction", "Prev Day High", "Prev Day Low", "Daily High", "Current Volume", "Trigger"].map((x) => <th key={x} className="px-4 py-3 font-semibold">{x}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {!loading && !grouped.length && <tr><td colSpan={9} className="px-4 py-14 text-center text-slate-500">No F&O stocks matched the current scanner conditions.</td></tr>}
                {grouped.map((row, index) => (
                  <tr key={`${row.instrumentKey}-${row.direction}-${index}`} className={row.direction === "BULLISH BREAKOUT" ? "bg-emerald-950/10 hover:bg-emerald-950/20" : "bg-red-950/10 hover:bg-red-950/20"}>
                    <td className="px-4 py-3 font-bold">{row.symbol}</td>
                    <td className="px-4 py-3 font-mono">₹{formatNumber(row.ltp)}</td>
                    <td className="px-4 py-3"><span className="rounded-md bg-slate-800 px-2 py-1 font-mono">{row.volumeMultiple.toFixed(2)}×</span></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.direction === "BULLISH BREAKOUT" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{row.direction}</span></td>
                    <td className="px-4 py-3 font-mono">₹{formatNumber(row.prevDayHigh)}</td>
                    <td className="px-4 py-3 font-mono">₹{formatNumber(row.prevDayLow)}</td>
                    <td className="px-4 py-3 font-mono">₹{formatNumber(row.dailyHigh)}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{formatVolume(row.currentVolume)}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{formatTime(row.triggerTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {data?.warnings?.length ? <details className="mt-4 rounded-xl border border-amber-900/60 bg-amber-950/20 p-3"><summary className="cursor-pointer text-sm font-semibold text-amber-300">Scanner warnings ({data.warnings.length})</summary><div className="mt-2 max-h-40 overflow-auto space-y-1 text-xs text-amber-200/70">{data.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div></details> : null}

        <footer className="mt-5 flex flex-col gap-1 text-xs text-slate-600 md:flex-row md:justify-between">
          <span>Data source: Upstox API v3</span>
          <span>Universe: NSE F&O stock underlyings only</span>
        </footer>
      </div>
    </main>
  );
}
