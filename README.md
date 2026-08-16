# BTC Up / Down

Guess whether the price of Bitcoin (BTC/USD) will be higher or lower in one minute. Correct guesses
score +1, wrong guesses score -1. Scores, streak, accuracy, and recent history persist per player —
close the tab and come back later and it's all still there.

**Live app:** https://d1gnkq5pco145h.cloudfront.net
**API base URL:** https://mdpev870u4.execute-api.eu-north-1.amazonaws.com

## How it works

- **Identity, no login.** On first visit, the app generates a random UUID in the browser and stores it
  in `localStorage`, and that UUID becomes the player's ID on every request. This is a deliberate scope
  call, not a shortcut: the requirement is persistence across sessions, not authenticated accounts, and
  building a login system would be solving a problem the assignment doesn't ask for. The tradeoff is
  explicit — clearing browser storage, or switching browser/device, starts a new player at score 0 — and
  worth stating plainly rather than leaving a reviewer to discover it.
- **Placing a guess.** Click Up or Down. The backend fetches the current BTC/USD price from Coinbase's
  public API *server-side* at the moment the guess is placed, and stores that as the entry price — the
  price used to resolve the guess is never trusted from the client, so it can't be gamed.
- **Resolution.** A guess resolves once **both** at least 60 seconds have passed **and** the price has
  actually moved from the entry price — exactly as specified. This is checked lazily: every time the app
  polls the backend (every 2.5s) or places a new guess, the server checks whether the pending guess is
  now resolvable, and if so, resolves it, updates the score/streak/accuracy, and clears it so a new guess
  can be placed. There's no separate cron/scheduler — resolution just happens on the next request after
  it's eligible.
- **Fairness under concurrency.** DynamoDB writes for placing/resolving a guess use conditional
  expressions (`ConditionExpression`), so two near-simultaneous requests for the same player can't both
  place a guess or both resolve the same one.
- **History, streak, accuracy.** The last 10 resolved guesses, current win streak, and win/total ratio
  are stored per player in DynamoDB and returned by the API, so all of it survives a refresh — not just
  the score. Players can also clear their own history/stats (score, streak, accuracy, and the recent-calls
  list) via a reset action in the UI; an in-flight pending guess, if any, is left alone so it still
  resolves fairly.

## Architecture

Fully serverless on AWS, defined as infrastructure-as-code in `backend/template.yaml` (AWS SAM /
CloudFormation) — one `sam deploy` creates everything:

- **API**: API Gateway (HTTP API) → 3 Lambda functions (Node.js 22) → DynamoDB
  - `GET /players/{playerId}` — fetch-or-create the player, lazily resolve a pending guess, return
    current state + live price
  - `POST /players/{playerId}/guess` — place a new guess (rejected with `409` if one is already pending)
  - `POST /players/{playerId}/reset` — clear score/streak/accuracy/history (leaves a pending guess intact)
- **Data store**: one DynamoDB table (`Players`, on-demand billing), keyed by `playerId`
- **Price feed**: [Coinbase's public spot price API](https://api.coinbase.com/v2/prices/BTC-USD/spot)
  (no API key required), called server-side only
- **Frontend hosting**: S3 (private, no public access) behind CloudFront using Origin Access Control —
  the bucket is never directly reachable, everything goes through CloudFront
- Region: `eu-north-1` (Stockholm)

Frontend: Angular 22 (standalone components, signals, zoneless change detection) + Tailwind CSS v4,
styled as a dark trading-terminal (Space Grotesk + JetBrains Mono, live sparkline chart, session
high/low, streak/accuracy stat pills). No state management library — the whole app is signals and a
handful of computed values.

## Design decisions & known limitations

Every non-obvious choice here was made deliberately, and it's worth stating the reasoning rather than
leaving it implicit:

- **Eventually consistent across tabs/devices, not real-time.** The app polls every 2.5s; it doesn't
  push updates over a WebSocket. Open the same player in two tabs and they'll converge within ~2.5s of
  each other, not instantly. For a single-player casual game this is a reasonable tradeoff — a real-time
  sync would mean API Gateway WebSockets + DynamoDB Streams, which is a legitimate next step but not
  needed for this scope.
- **Dark theme only, no light/dark toggle.** Deliberate call for a trading-app aesthetic, not an
  oversight — see the CSS custom properties in `frontend/src/styles.css` if you want to extend it.
- **History is capped at the last 10 resolved guesses per player**, by design — enough to feel like a
  history without the "Recent calls" card growing unbounded (it has its own fixed height and scrolls
  internally beyond that anyway).
- **Not production-hardened.** There's no rate limiting on the guess endpoint (DynamoDB conditional
  writes prevent double-guessing, but nothing stops someone from hammering the endpoint), no
  CloudWatch alarms/dashboards, and no WAF in front of API Gateway. Fine for an assessment; a real
  next step before calling this "production" would be `AWS::WAFv2` on the API + basic alarms on Lambda
  error rate / DynamoDB throttling.

## Running locally

Requires Node.js 22+, and either your own AWS backend deployed (see below) or the live one above.

```bash
cd frontend
npm install
npm start   # ng serve — http://localhost:4200
```

By default `environment.development.ts` points at the deployed API. To run fully locally instead,
point it at `http://127.0.0.1:3000` and run the backend locally with SAM (requires Docker):

```bash
cd backend
sam build
sam local start-api   # http://127.0.0.1:3000
```

## Testing

```bash
cd backend && npm test    # Jest — 17 tests: resolution rules, scoring/streak/accuracy, history, concurrency
cd frontend && npm test   # Vitest — 19 tests: P&L calc, countdown timing, relative-time formatting
```

## Deploying your own copy

Requires the AWS CLI and SAM CLI configured with your own credentials (`aws configure`).

**1. Backend + infra:**

```bash
cd backend
sam build
sam deploy --guided   # first time: pick a stack name, region, allow IAM role creation
```

Note the `ApiUrl`, `FrontendBucketName`, and `FrontendDistributionId` from the output.

**2. Frontend:**

Put your `ApiUrl` into `frontend/src/environments/environment.ts` and
`environment.development.ts`, then:

```bash
cd frontend
npm install
npm run build
aws s3 sync dist/frontend/browser s3://<FrontendBucketName> --delete
aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"
```

Your app is now live at the CloudFront URL from the stack outputs (`FrontendUrl`).
