import { NextRequest, NextResponse } from "next/server";
import { getConfiguredUniverse } from "@/lib/upstox";
import { marketHoursLikelyOpen, scanInstrument, validateScannerInputs } from "@/lib/scanner";
import type { ScannerMatch } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(request: NextRequest) {
  const started = Date.now();
  const warnings: string[] = [];

  try {
    const { timeframe, multiplier, priceThreshold } = validateScannerInputs(request.nextUrl.searchParams);
    const universe = await getConfiguredUniverse();
    if (!universe.length) {
      return NextResponse.json({ ok: false, error: "No NSE symbols found in instrument master." }, { status: 500 });
    }

    // Keep each serverless request comfortably below the execution limit. The
    // browser automatically continues with the next chunk until all NSE stocks
    // have been scanned.
    const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") ?? 0));
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 75);
    const limit = Math.max(25, Math.min(75, Number.isFinite(requestedLimit) ? requestedLimit : 75));
    const selected = universe.slice(offset, offset + limit);

    const batchSize = Math.max(1, Math.min(8, Number(process.env.SCAN_BATCH_SIZE ?? 8)));
    const delayMs = Math.max(0, Number(process.env.SCAN_BATCH_DELAY_MS ?? 50));
    const results: ScannerMatch[] = [];
    let scanned = 0;

    for (let i = 0; i < selected.length; i += batchSize) {
      const batch = selected.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        batch.map((instrument) => scanInstrument(instrument, timeframe, multiplier, priceThreshold)),
      );

      settled.forEach((item, index) => {
        scanned += 1;
        if (item.status === "fulfilled") results.push(...item.value);
        else warnings.push(`${batch[index].trading_symbol}: ${item.reason instanceof Error ? item.reason.message : "scan failed"}`);
      });

      if (i + batchSize < selected.length && delayMs > 0) await sleep(delayMs);
    }

    results.sort((a, b) => b.volumeMultiple - a.volumeMultiple);
    const completed = Date.now();
    return NextResponse.json({
      ok: true,
      scanned,
      matched: results.length,
      totalUniverse: universe.length,
      offset,
      limit: selected.length,
      hasMore: offset + selected.length < universe.length,
      timeframe,
      volumeMultiplier: multiplier,
      priceThreshold,
      startedAt: new Date(started).toISOString(),
      completedAt: new Date(completed).toISOString(),
      elapsedMs: completed - started,
      marketLikelyOpen: marketHoursLikelyOpen(),
      warnings: warnings.slice(0, 50),
      results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown scanner error" }, { status: 400 });
  }
}
