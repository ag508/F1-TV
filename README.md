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

### 3. Configure Xstream Credentials

Edit [client/src/App.jsx](client/src/App.jsx) and update the `XSTREAM_CONFIG` object:

```javascript
const XSTREAM_CONFIG = {
  server: "http://your-server.com:8080",
  username: "your_username",
  password: "your_password"
};
```

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
- `GET /restream/:channelId` - FFmpeg restream endpoint for IPTV channels
- `GET /health` - Health check endpoint

## Environment Variables

- `NODE_ENV` - Environment mode (production/development)
- `PORT` - Server port (default: 3000)

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
