# F1-TV Streaming App

A modern, real-time Formula 1 streaming application featuring live race streams, circuit maps, and race countdowns.

![F1-TV App](https://img.shields.io/badge/F1-TV%20App-red?style=for-the-badge&logo=formula1)
![Docker](https://img.shields.io/badge/Docker-Ready-blue?style=for-the-badge&logo=docker)
![CI/CD](https://img.shields.io/badge/CI%2FCD-Automated-green?style=for-the-badge&logo=github-actions)

## Features

- **Live F1 Race Streams** - Watch live F1 races from multiple sources (Sky Sports F1, DAZN F1, etc.)
- **Dynamic Circuit Maps** - Automatically displays the circuit layout for the upcoming race
- **Race Countdown Timer** - Real-time countdown to the next F1 race
- **IPTV Integration** - Supports Xstream IPTV with FFmpeg restreaming
- **Responsive Design** - Works seamlessly on desktop and mobile devices
- **Docker Support** - Easy deployment with Docker and Docker Compose
- **Automated CI/CD** - GitHub Actions pipeline for automatic Docker Hub deployments

## Tech Stack

- **Frontend**: React 19.2.0 + Vite
- **Backend**: Express.js + FFmpeg
- **Video Players**: HLS.js + mpegts.js
- **APIs**: Ergast F1 API, Xstream IPTV
- **Deployment**: Docker + GitHub Actions

## Quick Start

See [QUICKSTART.md](QUICKSTART.md) for rapid deployment instructions.

## Prerequisites

- Docker and Docker Compose installed
- Docker Hub account
- Xstream IPTV credentials (server URL, username, password)

## Local Development

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/f1-tv.git
cd f1-tv
```

### 2. Install Dependencies

**Client:**
```bash
cd client
npm install
```

**Server:**
```bash
cd ../server
npm install
```

### 3. Configure Channels (credentials stay server-side)

Provider credentials live **only on the server** — the client references each
channel by an opaque `key` (via `/api/channels`), so credentials never reach the
browser or the public client bundle. [server/channels.js](server/channels.js)
loads the channel list, in this order:

1. `CHANNELS_FILE=/path/to/channels.json` (explicit override)
2. `server/channels.local.json` (git-ignored local override)
3. `server/channels.json` (committed — **ships inside the Docker image**)
4. a built-in placeholder (no real credentials)

To set up: copy [server/channels.example.json](server/channels.example.json) to
`server/channels.json` and fill in your own provider lines. Each entry:

```json
{ "key": "f1-primary", "title": "Sky Sports F1 FHD", "quality": "1080p50",
  "english": true, "profile": "auto",
  "server": "http://your-provider:8080", "username": "USER", "password": "PASS",
  "channelId": 12345 }
```

Use one account per entry (each with a free connection slot) so the parallel
"Check Status" never hits a provider's per-account connection limit. `profile`
is optional: `auto` (default) copies browser-ready H.264 and transcodes HEVC to
1080p; `source` keeps the source untouched (e.g. a native 4K feed); `1080p`
always transcodes.

> ⚠️ **Security:** `server/channels.json` is committed so CI can build a
> self-contained Docker image. That means your provider credentials live in the
> Git repo and the image. Keep the repo and image **private**, or instead leave
> `channels.json` out and supply credentials at deploy time via `CHANNELS_FILE`
> or a mounted `channels.local.json`.

### 4. Run Development Servers

**Start the backend server:**
```bash
cd server
npm start
```

**Start the frontend dev server (in a new terminal):**
```bash
cd client
npm run dev
```

The app will be available at `http://localhost:5173`

## Docker Deployment

### Build and Run with Docker Compose

```bash
docker-compose up -d
```

The app will be available at `http://localhost:3001`

**Note:** By default, the app runs on port 3001 (mapped from container port 3000). To use a different port, edit `docker-compose.yml` line 8:
```yaml
ports:
  - "YOUR_PORT:3000"  # Change YOUR_PORT to any available port
```

### Build Docker Image Manually

```bash
docker build -t f1-tv:latest .
docker run -p 3001:3000 f1-tv:latest
```

**Custom Port:** Change `3001` to any available port on your host.

## GitHub + Docker Hub CI/CD Setup

### 1. Create GitHub Repository

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/f1-tv.git
git push -u origin main
```

### 2. Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add the following secrets:
- `DOCKER_USERNAME` - Your Docker Hub username
- `DOCKER_PASSWORD` - Your Docker Hub password or access token

### 3. Automatic Deployment

Once configured, every push to the `main` branch will:
1. Trigger GitHub Actions workflow
2. Build multi-platform Docker images (linux/amd64, linux/arm64)
3. Push images to Docker Hub as `YOUR_DOCKERHUB_USERNAME/f1-tv:latest`

### 4. Update on Server

After GitHub Actions completes, update your running container:

```bash
docker-compose pull
docker-compose up -d
```

Or using Docker directly:

```bash
docker pull YOUR_DOCKERHUB_USERNAME/f1-tv:latest
docker stop f1-tv-app
docker rm f1-tv-app
docker run -d -p 3000:3000 --name f1-tv-app YOUR_DOCKERHUB_USERNAME/f1-tv:latest
```

## Server Deployment (Ubuntu)

### 1. Install Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
```

Log out and back in for group changes to take effect.

### 2. Create docker-compose.yml

Create a file named `docker-compose.yml`:

```yaml
version: '3.8'

services:
  f1-tv:
    image: YOUR_DOCKERHUB_USERNAME/f1-tv:latest
    container_name: f1-tv-app
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - f1-network

networks:
  f1-network:
    driver: bridge
```

### 3. Deploy

```bash
docker-compose up -d
```

### 4. Update When New Version is Pushed

```bash
docker-compose pull && docker-compose up -d
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Repository                         │
│                   (Source Code + CI/CD)                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Push to main branch
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  GitHub Actions Workflow                     │
│          (Build Multi-Platform Docker Images)                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Push images
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      Docker Hub                              │
│              (YOUR_USERNAME/f1-tv:latest)                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Pull image
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Ubuntu Server                             │
│                  (Docker Container)                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              F1-TV Application                        │  │
│  │                                                       │  │
│  │  ┌─────────────────┐    ┌──────────────────────┐    │  │
│  │  │  React Client   │◄───┤   Express Server     │    │  │
│  │  │  (mpegts.js)    │    │   (FFmpeg Restream)  │    │  │
│  │  └─────────────────┘    └──────────┬───────────┘    │  │
│  │                                     │                │  │
│  │                                     │                │  │
│  │                                     ▼                │  │
│  │                          ┌─────────────────────┐    │  │
│  │                          │  Xstream IPTV API   │    │  │
│  │                          │  (Live F1 Streams)  │    │  │
│  │                          └─────────────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Stream Architecture

```
Xstream IPTV (HLS with 30-60s expiring tokens)
    ↓
FFmpeg (fetches as VLC, handles tokens, maintains connection)
    ↓
MPEG-TS output (piped to HTTP response)
    ↓
mpegts.js (decodes MPEG-TS in browser via MSE)
    ↓
Browser Video Element (native playback)
```

## Project Structure

```
F1-TV/
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.jsx        # Main app component
│   │   ├── App.css        # Styles
│   │   └── main.jsx       # Entry point
│   ├── public/            # Static assets
│   ├── package.json
│   └── vite.config.js
├── server/                # Express backend
│   ├── server.js          # Main server with FFmpeg restreaming
│   └── package.json
├── .github/
│   └── workflows/
│       └── docker-publish.yml  # CI/CD pipeline
├── Dockerfile             # Multi-stage Docker build
├── .dockerignore
├── docker-compose.yml
├── .gitignore
├── README.md
└── QUICKSTART.md
```

## Available Streams

- **Sky Sports F1 HD** - UK broadcast
- **Sky Sport F1 FHD** - Full HD feed
- **Sky F1 SD** - Standard definition
- **ES - Dazn F1** - Spanish DAZN
- **DE: Sky Sport F1 HD** - German Sky Sports

## API Endpoints

- `GET /` - Serve React frontend
- `GET /api/channels` - Live channel list (metadata only: key, title, quality; **no credentials**)
- `GET /restream/:channelId` - FFmpeg restream endpoint for IPTV channels (MPEG-TS)
- `GET /hls/:channel/index.m3u8` - HLS restream with a DVR buffer (auto-restarting FFmpeg). `:channel` is a registry key (credentials resolved server-side) or a raw channelId with `?server=&username=&password=`. `profile=auto` (default) copies the source when it is already browser-playable H.264 ≤1080p and transcodes to 1080p H.264 only when it is HEVC/UHD; `profile=1080p` always transcodes; `profile=source` always copies
- `GET /api/stream-health?key=` - Account + channel check by registry key (`probe=1` also reports the source codec/resolution); raw `server/username/password/channelId` also accepted
- `GET /api/live/status` - Current F1 session and its live status (from F1 live timing)
- `GET /api/live/stream` - Server-Sent Events: live timing snapshot (1/s) and car positions (4/s)
- `GET /api/live/circuit?key=&year=` - Circuit outline (MultiViewer, OpenF1 fallback)
- `GET /health` - Health check endpoint

## Live Session Detection & Telemetry

The hero shows the current weekend until its race is over. Every session (FP1-3, Sprint
Qualifying, Sprint, Qualifying, Race) comes from Jolpica, scheduled end times from OpenF1,
and the live state from the official F1 live timing feed. A session stays **LIVE** until F1
marks it `Finalised`, so delays, red flags and overruns don't flip the hero to the next race.

While a session is live the hero shows live telemetry: track map with cars, leaderboard with
tyres and gaps, track status, race control, weather and the selected driver's timing.
Since mid-2025 F1 only sends car GPS and car telemetry (speed/gear/throttle/brake/DRS) to
F1 TV subscribers. Set `F1TV_TOKEN` for these. Without it, car positions are interpolated
from the live mini-sector timing.

## Environment Variables

- `NODE_ENV` - Environment mode (production/development)
- `PORT` - Server port (default: 3001)
- `F1TV_TOKEN` - Optional F1 TV subscription token, enables GPS positions + car telemetry
- `LIVE_TIMING_DISABLED=1` - Don't connect to F1 live timing
- `LIVE_REPLAY` - Replay an archived session through the live pipeline for testing, e.g. `2026/2026-10-04_Bahrain_Grand_Prix/2026-10-04_Race/` (see `https://livetiming.formula1.com/static/2026/Index.json`)
- `LIVE_REPLAY_START` - Offset into the replay (`HH:MM:SS`, default: just before the start)
- `LIVE_REPLAY_SPEED` - Replay speed multiplier (default 1)
- `LIVE_REPLAY_GPS=0` - Replay without GPS/car data (preview what anonymous viewers get)
- `HLS_DEFAULT_PROFILE` - Profile for channels that don't set one: `abr` (default), `auto`, `1080p`, `source`
- `HLS_ABR_LADDER` - Adaptive bitrate renditions as `height:kbps[:fps]` (default `1080:6000,1080:4000:25,1080:3000,1080:2000:25`)
- `HLS_HWACCEL` - `auto` (default; use the Intel iGPU if it works), `vaapi`, or `none`
- `HLS_VAAPI_DEVICE` - GPU render node (default `/dev/dri/renderD128`)
- `HLS_ABR_SOFTWARE=1` - Allow the ABR ladder on the CPU when there's no GPU (heavy; off by default)
- `X264_PRESET` - x264 preset for CPU encoding (default `veryfast`; use `superfast` on weak CPUs)
- `HLS_1080P_BITRATE` - Bitrate (kbps) of the single-rendition 1080p transcode (default `6000`)
- `HLS_DVR_SECONDS` - How much of the stream is kept for resuming after buffering (default 600)

## Adaptive Bitrate & Intel GPU Encoding

Live channels are served as an **adaptive bitrate (ABR)** HLS ladder by default:
four 1080p renditions — 6 Mbps @50, 4 Mbps @25, 3 Mbps @50, 2 Mbps @25 — with
keyframes aligned at every 2 s segment. Every rendition is tagged with its frame
rate in the master playlist.

The player ("Auto") combines three rules, like the dash.js reference player:

1. **Device capability (proactive):** hls.js asks the browser's Media
   Capabilities API whether each rendition decodes smoothly and skips the ones
   that don't — e.g. a laptop that can't decode 1080p50 starts directly on
   1080p25 @ 4 Mbps (more bits per frame than the 50 fps top rung), so it never
   stutters in the first place.
2. **Dropped frames (reactive):** frames dropped/decoded are sampled every 2 s.
   Over 8% drops caps quality to the best lower-frame-rate rendition (over 20%
   with no lower frame rate available: the lightest); after 45 s of smooth
   playback it probes one rendition higher, doubling the wait each time a probe
   stutters again. Live catch-up is paused while frames are dropping.
3. **Bandwidth:** throughput with 25% headroom and fast-reacting averages, so a
   slower connection moves to a lighter 1080p rendition instead of buffering.

If a viewer still falls behind
(e.g. after a network blip), playback speeds up to 1.08× until it's back at the
live edge; after a long outage (>60 s) it jumps to live. Deliberately rewinding
in the DVR window turns catch-up off until you return to live. The player's
quality menu offers *Auto* or any fixed rendition.

Encoding the ladder needs a GPU: on an Intel CPU with integrated graphics
(e.g. i5-10400T / UHD 630) FFmpeg decodes and encodes with VAAPI (Quick Sync),
so several 1080p50 encodes cost almost no CPU. Pass the GPU into the container:

```yaml
services:
  f1-tv:
    devices:
      - /dev/dri:/dev/dri
```

At startup the server test-encodes on the GPU and logs either
`Intel VAAPI hardware encoding available` or why it's falling back. Without a
working GPU, `abr` falls back to a single 1080p rendition (copy when possible,
otherwise a CPU transcode). Check what each channel is doing at
`GET /api/hls/sessions`. On the host you can verify the GPU with
`docker exec -it f1-tv-app vainfo`.

## Troubleshooting

### Streams Not Playing

1. Verify Xstream credentials are correct in [client/src/App.jsx](client/src/App.jsx)
2. Check FFmpeg is installed: `ffmpeg -version`
3. Check browser console for mpegts.js errors
4. Verify the channel ID is correct for your IPTV provider

### Docker Build Fails

1. Ensure Docker has enough memory allocated (4GB+ recommended)
2. Clear Docker build cache: `docker builder prune -a`
3. Check FFmpeg installation in Dockerfile

### Circuit Map Not Loading

1. Check browser console for image 403 errors
2. Verify Ergast API is accessible: `https://ergast.com/api/f1/current/next.json`
3. Check circuit ID normalization logic in [client/src/App.jsx](client/src/App.jsx)

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Credits

- **F1 Data**: [Ergast F1 API](http://ergast.com/mrd/)
- **Circuit Maps**: [Wikimedia Commons](https://commons.wikimedia.org/)
- **Video Players**: [HLS.js](https://github.com/video-dev/hls.js/), [mpegts.js](https://github.com/xqq/mpegts.js)

## Support

For issues and feature requests, please open an issue on GitHub.
