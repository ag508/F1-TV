# F1-TV Quick Start Guide

Get your F1-TV app running in minutes!

## Prerequisites

- Docker and Docker Compose installed
- Channel sources configured in `server/channels.json` (Stremio addon URLs and/or Xstream IPTV accounts)
- Docker Hub account (for CI/CD setup)

## 🚀 Option 1: Deploy from Docker Hub (Fastest)

### 1. Pull and Run

```bash
docker pull YOUR_DOCKERHUB_USERNAME/f1-tv:latest
docker run -d -p 3000:3000 --name f1-tv-app YOUR_DOCKERHUB_USERNAME/f1-tv:latest
```

Access the app at: `http://localhost:3000`

### 2. Using Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  f1-tv:
    image: YOUR_DOCKERHUB_USERNAME/f1-tv:latest
    container_name: f1-tv-app
    ports:
      - "3000:3000"
    restart: unless-stopped
```

Run:

```bash
docker-compose up -d
```

## 🔧 Option 2: Build from Source

### 1. Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/f1-tv.git
cd f1-tv
```

### 2. Configure Channels

Edit `server/channels.json` (copy `server/channels.example.json` if starting
fresh). Stremio addon channels need the addon base URL + channel id; Xstream
IPTV channels need server/username/password/channelId. See the
[README](README.md#3-configure-channels-credentials-stay-server-side) for the
exact formats.

### 3. Build and Run

```bash
docker-compose up -d
```

Access at: `http://localhost:3000`

## 🌐 Option 3: Ubuntu Server Deployment

### 1. Install Docker (if not already installed)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
```

**Important:** Log out and back in after adding user to docker group.

### 2. Create Project Directory

```bash
mkdir ~/f1-tv && cd ~/f1-tv
```

### 3. Create docker-compose.yml

```bash
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  f1-tv:
    image: YOUR_DOCKERHUB_USERNAME/f1-tv:latest
    container_name: f1-tv-app
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF
```

### 4. Deploy

```bash
docker-compose up -d
```

### 5. Check Status

```bash
docker-compose ps
docker-compose logs -f
```

Access your server at: `http://YOUR_SERVER_IP:3000`

## 🔄 Setting Up CI/CD (GitHub + Docker Hub)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: F1-TV app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/f1-tv.git
git push -u origin main
```

### 2. Configure GitHub Secrets

1. Go to: `https://github.com/YOUR_USERNAME/f1-tv/settings/secrets/actions`
2. Click "New repository secret"
3. Add these secrets:
   - **Name:** `DOCKER_USERNAME` → **Value:** `your_dockerhub_username`
   - **Name:** `DOCKER_PASSWORD` → **Value:** `your_dockerhub_password_or_token`

### 3. Automatic Builds

Now every push to `main` branch will:
- ✅ Build Docker image
- ✅ Push to Docker Hub
- ✅ Tag as `latest`

### 4. Update Your Server

When a new version is pushed to GitHub:

```bash
cd ~/f1-tv
docker-compose pull
docker-compose up -d
```

**Or create an update script:**

```bash
cat > update.sh << 'EOF'
#!/bin/bash
cd ~/f1-tv
echo "Pulling latest image..."
docker-compose pull
echo "Restarting services..."
docker-compose up -d
echo "Update complete!"
docker-compose ps
EOF

chmod +x update.sh
```

Run updates with: `./update.sh`

## 📝 Common Commands

### View Logs
```bash
docker-compose logs -f
```

### Restart App
```bash
docker-compose restart
```

### Stop App
```bash
docker-compose down
```

### Update to Latest Version
```bash
docker-compose pull && docker-compose up -d
```

### Check Health
```bash
curl http://localhost:3000/health
```

### Rebuild from Source
```bash
docker-compose up -d --build
```

## 🔍 Troubleshooting

### Streams Not Playing

**Check FFmpeg is working:**
```bash
docker exec f1-tv-app ffmpeg -version
```

**View server logs:**
```bash
docker-compose logs -f
```

**Check Xstream credentials in App.jsx**

### Port Already in Use

Change port in `docker-compose.yml`:
```yaml
ports:
  - "8080:3000"  # Use port 8080 instead
```

### Container Won't Start

**Check logs:**
```bash
docker logs f1-tv-app
```

**Remove and recreate:**
```bash
docker-compose down
docker-compose up -d
```

## 🎯 What's Next?

1. ✅ Configure your channels in `server/channels.json`
2. ✅ Test the streams in your browser (Live tab → "Check feeds")
3. ✅ Set up GitHub repository
4. ✅ Configure GitHub Actions secrets
5. ✅ Push to GitHub to trigger automatic Docker Hub build
6. ✅ Deploy on your Ubuntu server
7. ✅ Enjoy live F1 streams!

## 📚 Need More Details?

See [README.md](README.md) for comprehensive documentation.

## 🏁 Success!

Your F1-TV app should now be running! Open your browser and navigate to:
- Local: `http://localhost:3000`
- Server: `http://YOUR_SERVER_IP:3000`

Enjoy the races! 🏎️💨
