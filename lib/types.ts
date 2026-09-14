export type Timeframe = 1 | 3 | 5;
export type Direction = "BULLISH BREAKOUT" | "BEARISH BREAKDOWN";

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}

export interface Instrument {
  segment: string;
  name: string;
  exchange: string;
  isin?: string;
  instrument_type: string;
  instrument_key: string;
  trading_symbol: string;
  underlying_symbol?: string;
  underlying_key?: string;
}

export interface ScannerMatch {
  symbol: string;
  instrumentKey: string;
  ltp: number;
  volumeMultiple: number;
  currentVolume: number;
  sma20Volume: number;
  direction: Direction;
  prevDayHigh: number;
  prevDayLow: number;
  dailyHigh: number;
  triggerTime: string;
  timeframe: Timeframe;
}

export interface ScanResponse {
  ok: boolean;
  scanned: number;
  matched: number;
  timeframe: Timeframe;
  volumeMultiplier: number;
  priceThreshold: number;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  marketLikelyOpen: boolean;
  warnings: string[];
  results: ScannerMatch[];
}
