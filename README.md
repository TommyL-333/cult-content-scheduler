# Cult Content Scheduler

AI-powered content automation system for TikTok Shop agencies.
Lark Bitable → Buffer → Instagram, TikTok, YouTube, LinkedIn, Facebook, X.

---

## 🚀 Running on Another Computer (5 min setup)

### 1. Clone & install
```bash
git clone https://github.com/TommyL-333/cult-content-scheduler.git
cd cult-content-scheduler
npm install
```

### 2. Set up credentials
```bash
cp .env.example .env
# Fill in your values — see .env.example for all keys and descriptions
```

### 3. Install FFmpeg
- **Mac:** `brew install ffmpeg`
- **Linux/Railway:** handled automatically by Dockerfile (`apt-get install ffmpeg`)
- **Windows:** Install via WinGet: `winget install Gyan.FFmpeg`, then update `FFMPEG_BIN` path in `scheduler.js`

### 4. Run
```bash
# Run once (check Lark queue and post anything ready)
node scheduler.js

# Run in watch mode — polls every 15 minutes (what Railway runs)
node scheduler.js --watch

# Poll Arcads for completed AI videos and queue them to Lark
node arcads-poller.js

# Poll until all Arcads videos are done
node arcads-poller.js --watch
```

---

## ☁️ Cloud (Railway — already running)

The system runs 24/7 on Railway at project `lively-purpose`, service `cultcontent-server`.
- Every GitHub push to `main` auto-deploys
- No laptop needed — Railway handles everything
- Env vars are set in Railway dashboard (Variables tab)

To deploy your own instance:
1. Fork the repo
2. Create new Railway project → Deploy from GitHub repo
3. Add all env vars from `.env.example` in Railway Variables → Raw Editor
4. Railway detects the Dockerfile automatically

---

## 📁 Key Files

| File | What it does |
|------|-------------|
| `scheduler.js` | Main loop — reads Lark "Ready" records, posts via Buffer/GHL |
| `arcads-poller.js` | Polls Arcads API for completed AI videos, writes to Lark queue |
| `edit-video.js` | Video editing pipeline (FFmpeg, Whisper transcription, captions) |
| `Dockerfile` | node:20-slim + ffmpeg — used by Railway |
| `railway.toml` | Railway build/deploy config |
| `.env.example` | Template with all required env var keys |
| `skills/` | Claude Code skills (cult-ideator, cult-scripter) |

---

## 🗺️ Platform Routing

Set the `Platforms` field in Lark to any of:

| Platform name (in Lark) | Posts to |
|------------------------|---------|
| `CC Instagram` | Cult Content Instagram only |
| `CC YouTube` | Cult Content YouTube only |
| `CC LinkedIn` | Cult Content LinkedIn |
| `CC Facebook` | Cult Content Facebook |
| `CC X` | Cult Content X |
| `Instagram` | CC + Tommy Instagram (both) |
| `YouTube` | CC + Tommy YouTube (both) |
| `TikTok` | Cult Content TikTok (via GHL) |
| `Tommy Instagram` | Tommy personal Instagram only |
| `Tommy TikTok` | Tommy personal TikTok only |
| `Tommy YouTube` | Tommy personal YouTube only |
| `Tommy LinkedIn` | Tommy personal LinkedIn only |

---

## 🤖 Arcads AI Video Pipeline

Generate AI UGC videos at scale via the Arcads API.

**How we use it:**
1. Write scripts (5 hooks × 8 actors = 40 videos per batch)
2. Fire `POST /v1/scripts` + `POST /v1/scripts/{id}/generate` for each
3. Run `node arcads-poller.js --watch` — auto-queues finished videos to Lark
4. Scheduler picks them up and posts to CC Instagram, TikTok, LinkedIn, YouTube

**Arcads API base:** `https://external-api.arcads.ai`
**Auth:** Basic — credentials in `.env` as `ARCADS_CLIENT_ID` / `ARCADS_CLIENT_SECRET`

**Platform names for Arcads content:** `CC Instagram`, `TikTok`, `CC LinkedIn`, `CC YouTube`

---

## 📋 Lark Setup

Three Lark bases power the system:

| Base | Token | Purpose |
|------|-------|---------|
| Content Scheduler Queue | `P501bI8KwaKvT7siDrZukMrWtAf` | Posting queue (scheduler reads this) |
| Automate Everything v2 | `AjW5bgC4TaAehfsfCxru9Muxtwx` | Sellers, videos, products, performance |
| Operations | `IGtFbXL6Ia5svAsL7c3uf03osSc` | Team, clients, tasks |

**To queue a post:** Add a record to Content Scheduler Queue with:
- `Content` — caption/text
- `Media URL` — video URL (Google Drive links auto-converted to CDN)
- `Platforms` — one or more platform names from the table above
- `Scheduled Date` — date to post
- `Status` = `Ready`

---

## 🔑 Required Environment Variables

See `.env.example` for full list. Key groups:

- **Lark:** `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BITABLE_APP_TOKEN`, `LARK_BITABLE_TABLE_ID`
- **GHL:** `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_BASE_URL`
- **Buffer:** `BUFFER_API_KEY` + channel IDs for each platform
- **Arcads:** `ARCADS_CLIENT_ID`, `ARCADS_CLIENT_SECRET` (Basic auth credentials)
- **OpenAI:** `OPENAI_API_KEY` (Whisper transcription for video editing)

---

## 📦 Replicating for a New Agency

1. Clone repo, set up own `.env` with agency's API keys
2. Create a new Lark workspace (clone from master template)
3. Update `LARK_BITABLE_APP_TOKEN` + `LARK_BITABLE_TABLE_ID` in `.env`
4. Connect agency's social accounts to Buffer, update Buffer channel IDs
5. Deploy own Railway project from forked repo
6. Done — fully independent instance

---

*Built by Cult Content. Questions → Tommy Lynch.*
