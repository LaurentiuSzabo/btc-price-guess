# BTC Up / Down

Guess whether the price of Bitcoin (BTC/USD) will be higher or lower in one minute. Correct guesses
score +1, wrong guesses score -1. Scores, streak, accuracy, and recent history persist per player —
close the tab and come back later and it's all still there.

**Live app:** https://d1gnkq5pco145h.cloudfront.net
**API base URL:** https://mdpev870u4.execute-api.eu-north-1.amazonaws.com
**WebSocket URL:** wss://tz48f7xl5a.execute-api.eu-north-1.amazonaws.com/prod

## How it works

- **Identity, no login.** On first visit, the app generates a random UUID in the browser and stores it
  in `localStorage`, and that UUID becomes the player's ID on every request. No signup, no password, no
  friction — you land on the page and you're already playing, and your score, streak, and history are
  right there again if you close the tab and come back later. Clearing browser storage, or switching to
  a different browser or device, starts a fresh player at score 0.
- **Placing a guess.** Click Up or Down. The backend fetches the current BTC/USD price from Coinbase's
  public API *server-side* at the moment the guess is placed, and stores that as the entry price — the
  price used to resolve the guess is never trusted from the client, so it can't be gamed.
- **Resolution.** A guess resolves once **both** at least 60 seconds have passed **and** the price has
  actually moved from the entry price. This is checked lazily: every time the server handles a guess,
  a tick, or a plain read for that player, it checks whether the pending guess is now resolvable, and
  if so, resolves it, updates the score/streak/accuracy, and clears it so a new guess can be placed.
  There's no separate cron/scheduler — resolution just happens on the next touch after it's eligible.
- **Live, and synced across tabs.** After the first paint, the app connects over a WebSocket and sends
  a lightweight "tick" every 2.5s instead of polling over HTTP. Whichever tab's tick (or guess, or
  reset) causes a state change, the server pushes the result to *every* tab currently watching that
  player — open the same player in two tabs and they update in lockstep, not on their own independent
  polling schedules. If the socket can't connect or keeps dropping (some networks block WebSockets),
  the app quietly falls back to the old HTTP polling behavior instead of breaking.
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

- **HTTP API**: API Gateway (HTTP API) → 3 Lambda functions (Node.js 22) → DynamoDB
  - `GET /players/{playerId}` — fetch-or-create the player, lazily resolve a pending guess, return
    current state + live price
  - `POST /players/{playerId}/guess` — place a new guess (rejected with `409` if one is already pending)
  - `POST /players/{playerId}/reset` — clear score/streak/accuracy/history (leaves a pending guess intact)
- **WebSocket API**: a separate API Gateway (WebSocket) + one router Lambda handling `$connect`,
  `$disconnect`, `subscribe`, and `tick`. No DynamoDB Streams in the middle — whichever Lambda (HTTP or
  WS) just wrote a change looks up who's subscribed to that player (via a `ConnectionsTable` GSI) and
  pushes the new state to each of them directly with the API Gateway Management API. Connection records
  carry a TTL matching API Gateway's own 2-hour max WebSocket lifetime, so a missed `$disconnect` cleans
  itself up.
- **Data store**: two DynamoDB tables, both on-demand billing — `Players` (keyed by `playerId`) and
  `Connections` (keyed by `connectionId`, GSI on `playerId`)
- **Price feed**: [Coinbase's public spot price API](https://api.coinbase.com/v2/prices/BTC-USD/spot)
  (no API key required), called server-side only
- **Frontend hosting**: S3 (private, no public access) behind CloudFront using Origin Access Control —
  the bucket is never directly reachable, everything goes through CloudFront
- Region: `eu-north-1` (Stockholm)

Frontend: Angular 22 (standalone components, signals, zoneless change detection) + Tailwind CSS v4,
styled as a trading-terminal (Space Grotesk + JetBrains Mono, live sparkline chart, session high/low,
streak/accuracy stat pills), with a light/dark theme toggle — the choice persists in `localStorage` and
is applied before Angular even boots, so there's no flash of the wrong theme on reload. No state
management library — the whole app is signals and a handful of computed values.

**Observability:** CloudWatch alarms on Lambda error rates and DynamoDB throttling publish to an SNS
topic (`AlarmTopicArn` in the stack outputs) — subscribe an email or Slack webhook to it to get paged.

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

Note the `ApiUrl`, `WebSocketUrl`, `FrontendBucketName`, and `FrontendDistributionId` from the output.

**2. Frontend:**

Put your `ApiUrl` and `WebSocketUrl` into `frontend/src/environments/environment.ts` and
`environment.development.ts`, then:

```bash
cd frontend
npm install
npm run build
aws s3 sync dist/frontend/browser s3://<FrontendBucketName> --delete
aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"
```

Your app is now live at the CloudFront URL from the stack outputs (`FrontendUrl`).
