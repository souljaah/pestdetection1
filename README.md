# Smart Agriculture Monitoring Dashboard

A React/Vite dashboard backed by a Flask REST API that stores everything in SQLite:
pest detections, spray logs, system events, alerts, camera stream URLs and settings.

## Architecture

- Frontend: React 19, TypeScript, Vite (`src/`)
- API: Flask in `api/index.py`, schema in `api/schema.sql`
- Database:
  - **Local development:** a SQLite file at `instance/agri.sqlite3` (created automatically)
  - **Production on Vercel:** Turso/libSQL (SQLite-compatible), because Vercel Functions
    have no persistent disk
- In development Vite proxies `/api/*` to Flask on `http://127.0.0.1:5001` (port 5000 is left for the camera's `camera_server.py`)
- Device writes (`POST /api/detections`, `POST /api/sprays/trigger`): bearer `DEVICE_API_KEY`
- Dashboard writes: same-origin cookie/header CSRF protection (`GET /api/csrf` issues the token)

There is no login (the original website has none). Anyone who can open the dashboard can
change settings and camera URLs, so do not expose it to the internet without authentication.

## Run locally

Requirements: Python 3.11+, Node.js 22+, pnpm 10 (`npm install -g pnpm` or `corepack enable`).

```bash
pnpm install
python -m venv .venv
```

Activate the virtual environment (Windows PowerShell: `.venv\Scripts\Activate.ps1`,
Windows cmd: `.venv\Scripts\activate.bat`, macOS/Linux: `source .venv/bin/activate`), then:

```bash
pip install -r requirements-dev.txt
```

Start the API (terminal 1, venv active) and the dashboard (terminal 2):

```bash
pnpm run dev:api
```

```bash
pnpm run dev
```

Open http://localhost:8443. On first start the API creates `instance/agri.sqlite3`,
the seven tables, the four zones/cameras and the default settings row. To create or check
the schema yourself (safe to rerun, never drops data):

```bash
python -m scripts.migrate
python -m scripts.migrate --check
```

## Verify that data is saved

1. **System Settings** → toggle *Real-Time Notifications* → **Save Settings**. The note reads
   "Saved to the database" and *SQLite Database* shows "SQLite connected".
2. **Live Monitoring** (or **Camera Status**) → **Connect** → enter a stream URL → Enter.
   **Change** updates it, **Disconnect** removes it.
3. Stop both servers, start them again and reload: the settings and stream URL are still
   there, also after clearing the browser's site data (they are loaded from SQLite).
4. To inspect the file directly:
   `python -c "import sqlite3; c=sqlite3.connect('instance/agri.sqlite3'); print(c.execute('select zone_id, stream_url from cameras').fetchall(), c.execute('select * from system_settings').fetchall())"`

Detections and spray activations are written by the embedded device, not the dashboard.
To send one the way the device will, set a key before starting the API
(PowerShell: `$env:DEVICE_API_KEY="dev-key"`, bash: `export DEVICE_API_KEY=dev-key`) and send:

```bash
curl -X POST http://127.0.0.1:5001/api/detections -H "Content-Type: application/json" -H "Authorization: Bearer dev-key" -d "{\"zoneId\":1,\"pestClass\":\"Aphid\",\"confidence\":94.7}"
```

The detection then appears on Dashboard, Detection Logs, History and in the header alerts.

## Camera stream URLs

Saved in `cameras.stream_url`. The browser also keeps a copy so a saved URL appears
instantly and cameras keep working while the API is down. A URL changed while the API is
unreachable is shown with a "Not saved to the database" note and saved automatically
once the API answers again; a URL the API rejects (not `http://`, `https://` or `/…`) is
shown with "Not saved — …" and not kept. URLs saved in a browser before the database
existed are moved into the database the first time that browser reaches the API.

## API

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health`, `/api/system-status` | any | Database and schema health |
| GET | `/api/csrf` | dashboard | Issue the CSRF token used by dashboard writes |
| GET | `/api/zones`, `/api/cameras`, `/api/cameras/telemetry` | any | Zones, cameras, stream URLs |
| PUT | `/api/zones/{id}/stream` | dashboard | Save/clear a zone's camera stream URL |
| GET | `/api/detections`, `/api/detections/current` | any | Detection log / live overlays |
| POST | `/api/detections` | device | Record a detection (+ event and alert, one transaction) |
| GET | `/api/sprays` | any | Spray log |
| POST | `/api/sprays/trigger` | device | Record a spray (+ event and alert, one transaction) |
| GET | `/api/events`, `/api/alerts` | any | History timeline, unacknowledged alerts |
| GET / PUT | `/api/settings` | dashboard | Detection configuration |

## Test

Backend tests use a temporary SQLite file and never touch Turso:

```bash
pytest
pnpm run build
```

## Hosting limitations

- **Figma Make preview/hosting** serves only the static frontend. It cannot run Flask or
  keep a SQLite file, so the API calls fail there. Run the stack locally, or deploy to Vercel.
- **Vercel** runs `api/index.py` as a serverless function whose filesystem is read-only and
  discarded between requests, so a SQLite file would lose every write. The API therefore
  refuses to start on Vercel without Turso credentials. Turso is SQLite-compatible and uses
  the same `api/schema.sql`.
- Any host with a persistent disk that can run a long-lived Python process (a VPS, a
  Raspberry Pi next to the cameras, Render/Railway with a volume) can use the plain SQLite
  file: build the frontend with `pnpm run build`, serve `dist/`, and proxy `/api` to Flask
  running under a production WSGI server.

## Vercel deployment (Turso)

1. Create the database:
   ```bash
   turso auth login
   turso db create smart-agriculture
   turso db show smart-agriculture --url
   turso db tokens create smart-agriculture
   ```
2. In **Project → Settings → Environment Variables**, add `TURSO_DATABASE_URL`,
   `TURSO_AUTH_TOKEN` and `DEVICE_API_KEY` (generate one with
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`). Never prefix them with `VITE_`.
3. If the API is hosted separately, set `ALLOWED_ORIGINS` to the exact HTTPS frontend
   origins. Leave it empty for the recommended same-origin deployment.
4. With the same two Turso variables exported in your shell, run `python -m scripts.migrate` once.
5. Deploy. `vercel.json` builds Vite into `dist` and rewrites `/api/*` to Flask.
6. Check `https://YOUR_DOMAIN/api/health` and repeat the verification steps above.

Vercel Functions are not suitable for indefinite MJPEG or WebSocket connections, so HTTP
camera streams still need an HTTPS camera gateway, reverse proxy, or tunnel.

## Live recordings

- `pnpm run dev` now starts the Flask API by itself (using `.venv` when present), so `/api`
  no longer answers 502 because the API was forgotten. If the API is already running it is
  reused. Turn this off with `API_AUTOSTART=0`; use another port with `API_PORT=5002`.
- Every camera feed that is live on **Live Monitoring** is recorded by the API (a red
  **REC** badge shows on the feed). Recordings are stored in `instance/recordings/` and
  listed in the `recordings` table; rewatch, seek or delete them on the **Recordings** page.
- Recording stops when the feed goes offline, you leave the page, or about 90 s after the tab
  is closed. Sessions longer than 30 minutes are split into separate recordings.
- MJPEG (ESP32-CAM, IP cameras), JPEG snapshot URLs and direct `.mp4`/`.webm` files can be
  recorded; HLS (`.m3u8`) cannot. Recording needs the local API (not available on Vercel,
  which has no persistent disk).

## Pest detection (YOLO model)

- Put the trained model in `models/` (the aphid model is `models/aphid_detector_best.pt`;
  or set `DETECTION_MODEL=path/to/model.pt`) and install the detector once, venv active:
  `pip install -r requirements-detect.txt`.
- While a feed is live on **Live Monitoring**, the API runs the model on the frames it is
  recording and draws a red box with the confidence around every aphid. The *AI MODEL* line
  under the feed shows whether the model is running and what it found.
- A detection is saved to Detection Logs / History / alerts when a pest appears (at most once
  every 30 s per zone, so a pest that stays in view is not logged on every frame).
- Only boxes at or above **System Settings → Detection Confidence Threshold** count. The
  aphid model typically scores 75–85 %, so set the threshold to about 60–70 % to see them.
- Live boxes are smoothed over frames: a pest is shown once it is found in 2 frames in a
  row (removes one-frame false alarms) and stays through 2 missed frames (less flicker).
  Measured on the 32 labeled validation images (190 aphids), the model finds 86 % of aphids
  with 92 % of boxes correct at a 50 % threshold, but only 33 % of aphids at 85 %.
- The boxes are saved with each recording (`instance/recordings/<id>-boxes.jsonl`) and drawn
  again on the **Recordings** page at the moment they were found. Red marks on the timeline
  show where pests appear, recordings with a pest show **⚠ PEST**, and *Boxes on/off*
  hides them.
