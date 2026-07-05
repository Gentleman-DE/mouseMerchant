# MouseMerchant

MouseMerchant is a secure, dockerized service for MyAnonamouse point monitoring and bonus upload purchases. It keeps the original point-checking purpose of the old project, but replaces the ad hoc Nest app with a single hardened service.

## What it does

- Polls MAM for current `seedbonus` points on a schedule
- Optionally buys upload credit automatically when points exceed your reserve
- Lets you trigger a manual check or buy from the API or web GUI
- Stores the MAM cookie and API token encrypted at rest
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
docker compose up --build
```

On first startup with the web UI enabled, set:

```bash
MOUSEMERCHANT_MASTER_KEY=...
MOUSEMERCHANT_ADMIN_PASSWORD=...
```

Then open `http://localhost:3000`.

The included `docker-compose.yml` is already wired for Docker secrets:

```bash
mkdir -p secrets
printf '%s' 'your-master-key' > secrets/master_key.txt
printf '%s' 'your-admin-password' > secrets/admin_password.txt
chmod 600 secrets/master_key.txt secrets/admin_password.txt
docker compose up --build
```

## Important environment variables

- `MOUSEMERCHANT_MASTER_KEY`: required, long random secret for at-rest encryption
- `MOUSEMERCHANT_MASTER_KEY_FILE`: file-based form for Docker secrets
- `MOUSEMERCHANT_STATE_DIR`: optional, defaults to `./data`
- `MOUSEMERCHANT_ADMIN_PASSWORD_FILE`: file-based form for Docker secrets
- `MOUSEMERCHANT_ADMIN_PASSWORD`: required on first startup if web UI is enabled
- `MOUSEMERCHANT_INITIAL_MAM_COOKIE`: optional initial `mam_id` cookie value
- `MOUSEMERCHANT_WEB_ENABLED`: `true` or `false`
- `MOUSEMERCHANT_HTTPS_ONLY_COOKIES`: set `true` behind HTTPS
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
