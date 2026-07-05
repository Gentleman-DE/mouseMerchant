# MouseMerchant

MouseMerchant is a secure, dockerized service for MyAnonamouse point monitoring and bonus upload purchases. It keeps the original point-checking purpose of the old project, but replaces the ad hoc Nest app with a single hardened service.

## What it does

- Polls MAM for current `seedbonus` points on a schedule
- Optionally buys upload credit automatically when points exceed your reserve
- Lets you trigger a manual check or buy from the API or web GUI
- Stores the MAM cookie encrypted at rest
- Stores the admin password hashed, not plaintext
- Exposes the web GUI only when `MOUSEMERCHANT_WEB_ENABLED=true`

## Security model

- `MOUSEMERCHANT_MASTER_KEY` is required and is used to encrypt secrets on disk
- Web login uses an `HttpOnly` session cookie
- Host header allowlisting is enabled by default
- Cross-origin access is denied unless you explicitly allow origins

## Quick start

```bash
npm install
npm run dev
```

Or with Docker:

```bash
cp .env.example .env
# edit .env
docker compose up --build
```

On first startup with the web UI enabled, set:

```bash
MOUSEMERCHANT_MASTER_KEY=...
MOUSEMERCHANT_ADMIN_PASSWORD=...
```

Then open `http://localhost:3000`.

For Dockhand or similar tools, the simplest setup is plain environment variables via `.env`:

```bash
cp .env.example .env
# fill in MOUSEMERCHANT_MASTER_KEY and MOUSEMERCHANT_ADMIN_PASSWORD
docker compose up --build
```

If you prefer Docker secrets, the app still supports `*_FILE` environment variables even though the default Compose file no longer uses them.

## Important environment variables

- `MOUSEMERCHANT_MASTER_KEY`: required, long random secret for at-rest encryption
- `MOUSEMERCHANT_MASTER_KEY_FILE`: file-based form for Docker secrets
- `MOUSEMERCHANT_STATE_DIR`: optional, defaults to `./data`
- `MOUSEMERCHANT_ADMIN_PASSWORD_FILE`: file-based form for Docker secrets
- `MOUSEMERCHANT_ADMIN_PASSWORD`: required on first startup if web UI is enabled
- `MOUSEMERCHANT_INITIAL_MAM_COOKIE`: optional initial `mam_id` cookie value
- `MOUSEMERCHANT_INITIAL_SCHEDULE_TIME`: optional daily schedule anchor, default `01:00`
- `MOUSEMERCHANT_WEB_ENABLED`: `true` or `false`
- `MOUSEMERCHANT_HTTPS_ONLY_COOKIES`: set `true` behind HTTPS
- `TZ`: container timezone for scheduler alignment, for example `Europe/Berlin`
- `MOUSEMERCHANT_INITIAL_INTERVAL_MS`: polling interval, default `86400000`
- `MOUSEMERCHANT_INITIAL_RESERVE_POINTS`: reserve to keep before auto-buy
- `MOUSEMERCHANT_INITIAL_BUY_AMOUNT_GB`: upload amount to buy, default `50`
- `MOUSEMERCHANT_INITIAL_AUTO_BUY_ENABLED`: enable auto-buy, default `true`
- `MOUSEMERCHANT_ALLOWED_HOSTS`: comma-separated host allowlist, default `localhost,127.0.0.1,[::1]`
- `MOUSEMERCHANT_ALLOWED_ORIGINS`: comma-separated allowed origins, default same-origin only

All secret env vars also support `*_FILE`.

## API

- `POST /api/login`
- `POST /api/logout`
- `GET /api/state`
- `PUT /api/settings`
- `PUT /api/secrets`
- `PUT /api/admin-password`
- `POST /api/actions/run`
- `POST /api/actions/buy`
- `GET /health`

Use the web UI session cookie for authenticated endpoints.
