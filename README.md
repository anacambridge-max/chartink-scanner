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

## Upstox API details

The project uses Upstox API v3 intraday candles at:

```text
GET /v3/historical-candle/intraday/:instrument_key/minutes/:interval
```

Upstox V3 supports custom minute intervals, including 1, 3 and 5 minutes. The app also uses V3 daily historical candles to determine the previous trading session's High/Low.

The instrument master is downloaded from Upstox's NSE BOD JSON feed and filtered to `NSE_EQ` instruments. `instrument_key` is used throughout the API client.

## 1. Create an Upstox developer application

Create an app in the Upstox Developer Console and copy:

- API Key
- API Secret
- Redirect URI

Keep the API secret server-side. Never expose it as `NEXT_PUBLIC_*`.

## 2. Generate the daily access token

Upstox access tokens have a defined expiry and are not long-lived. Generate/approve a fresh access token for the trading day and put it into `UPSTOX_ACCESS_TOKEN`. The token expiry is shown by Upstox and can expire at 3:30 AM the following day depending on when the request is initiated.

For this scanner, the simplest production workflow is:

1. Generate/approve the Upstox access token using your registered OAuth redirect URI.
2. Copy the access token.
3. Update the Vercel environment variable `UPSTOX_ACCESS_TOKEN`.
4. Redeploy or refresh the deployment so the new environment variable is active.

Do not commit the token to GitHub.

## 3. Local setup

```bash
git clone https://github.com/anacambridge-max/chartink-scanner.git
cd chartink-scanner
npm install
cp .env.example .env.local
```

Set:

```env
UPSTOX_API_KEY=...
UPSTOX_API_SECRET=...
UPSTOX_ACCESS_TOKEN=...
```

Optional universe control:

```env
# Empty = all NSE_EQ / BE instruments from Upstox instrument master
NSE_SYMBOLS=RELIANCE,INFY,TCS,SBIN
```

Optional performance tuning:

```env
SCAN_BATCH_SIZE=8
SCAN_BATCH_DELAY_MS=250
INSTRUMENT_CACHE_TTL_SECONDS=86400
```

Run:

```bash
npm run dev
```

Open `http://localhost:3000`.

## 4. How the scanner works

Every scan request sends the selected settings to `/api/scan`.

The server downloads/caches the NSE instrument master, builds the configured universe, then scans symbols in rate-limited parallel batches. Each symbol fetches:

- current-day 1/3/5-minute candles
- a small daily historical window from which the latest candle before today is selected as the previous trading day

For the most recent intraday candle:

- the last 20 completed timeframe candles are used for volume SMA(20)
- the current candle volume must be strictly greater than SMA × multiplier
- current candle High > previous day High triggers bullish
- current candle Low < previous day Low triggers bearish
- running daily High must be strictly greater than the configured price threshold

Failed individual symbols are recorded as warnings rather than aborting the whole scan.

## 5. GitHub

```bash
git add .
git commit -m "build real-time Upstox scanner"
git push origin main
```

## 6. Vercel deployment

Import this GitHub repository into Vercel.

Add these Environment Variables for Production (and Preview if desired):

```text
UPSTOX_API_KEY
UPSTOX_API_SECRET
UPSTOX_ACCESS_TOKEN
NSE_SYMBOLS
SCAN_BATCH_SIZE
SCAN_BATCH_DELAY_MS
INSTRUMENT_CACHE_TTL_SECONDS
```

Then deploy.

### Serverless runtime note

The scan route runs in the Node.js runtime and has a maximum duration configured in the route. For a very large full-NSE universe, Vercel execution time and Upstox rate limits can make one request expensive. In that case, start with an F&O symbol list or a curated liquid NSE universe and tune `SCAN_BATCH_SIZE` / `SCAN_BATCH_DELAY_MS`.

## 7. API example

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
- Upstox access tokens
- API secrets
- client-side copies of credentials

The browser only calls the app's own `/api/scan` endpoint; Upstox credentials stay on the server.
