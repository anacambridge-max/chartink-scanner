# Upstox Chartink-Style Real-Time Scanner

A Next.js App Router dashboard that evaluates the requested scanner logic against NSE equities using Upstox API v3 candles.

## Scanner logic

For the selected timeframe (`1m`, `3m`, or `5m`):

```text
Current timeframe volume > SMA(volume, 20) × volume multiplier
AND
(
  Current candle High > previous trading day's High
  OR
  Current candle Low < previous trading day's Low
)
AND
Today's running Daily High > price threshold
```

A matching candle creates `BULLISH BREAKOUT` and/or `BEARISH BREAKDOWN`. If both breakout directions are true on the same candle, two rows are shown.

The dashboard defaults to 1 minute, 2× volume, `Daily High > 50`, and 30-second refresh.

## Upstox authentication

This project is designed to use the **Upstox Analytics Token** shown under **Upstox → Apps → Analytics**.

Only one environment variable is required:

```env
UPSTOX_ACCESS_TOKEN=your_analytics_token
```

The Analytics Token is a long-lived, read-only token intended for market-data APIs. You do **not** need to add `UPSTOX_API_KEY`, `UPSTOX_API_SECRET`, or a daily OAuth access-token flow for this scanner.

**Never commit the token to GitHub or expose it as a `NEXT_PUBLIC_*` variable.**

## Upstox API details

The project uses Upstox API v3 intraday candles at:

```text
GET /v3/historical-candle/intraday/:instrument_key/minutes/:interval
```

The scanner uses 1, 3 and 5 minute intervals and V3 daily historical candles for the previous trading session's High/Low.

The NSE instrument master is downloaded from Upstox's NSE BOD JSON feed and filtered to `NSE_EQ` instruments. `instrument_key` is used throughout the API client.

## 1. Local setup

```bash
git clone https://github.com/anacambridge-max/chartink-scanner.git
cd chartink-scanner
npm install
cp .env.example .env.local
```

Put your Analytics Token in `.env.local`:

```env
UPSTOX_ACCESS_TOKEN=...
```

Optional universe control:

```env
# Empty = all NSE_EQ / BE instruments from Upstox instrument master
NSE_SYMBOLS=RELIANCE,INFY,TCS,SBIN
```

Run:

```bash
npm run dev
```

Open `http://localhost:3000`.

## 2. How the scanner works

Every scan request sends the selected settings to `/api/scan`.

The server downloads/caches the NSE instrument master, builds the configured universe, then scans symbols in rate-limited parallel batches. Each symbol fetches:

- current-day 1/3/5-minute candles
- a daily historical window from which the latest candle before today is selected as the previous trading day

For the most recent intraday candle:

- the last 20 completed timeframe candles are used for volume SMA(20)
- the current candle volume must be strictly greater than SMA × multiplier
- current candle High > previous day High triggers bullish
- current candle Low < previous day Low triggers bearish
- running daily High must be strictly greater than the configured price threshold

Failed individual symbols are recorded as warnings rather than aborting the whole scan.

## 3. GitHub

```bash
git add .
git commit -m "build real-time Upstox scanner"
git push origin main
```

## 4. Vercel deployment

Import this GitHub repository into Vercel.

Add **only this required Environment Variable**:

```text
UPSTOX_ACCESS_TOKEN
```

Paste the full Analytics Token from Upstox Apps → Analytics as its value.

`NSE_SYMBOLS` is optional. Leave it unset/empty to scan the NSE universe from the Upstox instrument master.

Then deploy.

### Serverless runtime note

The scan route runs in the Node.js runtime and uses rate-limited batches. For a very large full-NSE universe, Vercel execution time and Upstox rate limits can make one request expensive. Start with a liquid/F&O symbol list if necessary; the scanner logic itself remains unchanged.

## 5. API example

```text
GET /api/scan?timeframe=1&multiplier=2&priceThreshold=50
```

The JSON response includes:

```json
{
  "ok": true,
  "scanned": 0,
  "matched": 0,
  "timeframe": 1,
  "volumeMultiplier": 2,
  "priceThreshold": 50,
  "elapsedMs": 0,
  "warnings": [],
  "results": []
}
```

Each match contains symbol, LTP, volume multiple, direction, previous-day High/Low, running daily High, current volume and trigger timestamp.

## Security

Never commit:

- `.env.local`
- Upstox Analytics Tokens
- API secrets
- client-side copies of credentials

The browser only calls the app's own `/api/scan` endpoint; the Upstox token stays on the server.
