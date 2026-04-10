# Cult Content Scheduler — Claude Context

This project is the AI-powered content operations system for Cult Content, a TikTok Shop growth agency managed by Tommy Lynch.

## What This Repo Does

`scheduler.js` reads "Ready" records from a Lark Bitable content queue, schedules posts via GHL (Facebook, Instagram, TikTok, LinkedIn, YouTube) and PhantomBuster (X/Twitter), and updates the record status back in Lark.

Run once: `node scheduler.js`
Watch mode (every 15 min): `node scheduler.js --watch`

## Skills
- `/cult-ideator` — generates video concepts → writes Draft records to Content Pipeline
- `/cult-scripter` — takes a Draft idea → writes full filming card → saves back to Lark

Skill files: `skills/cult-ideator.md` and `skills/cult-scripter.md`
Also installed globally at `~/.claude/skills/`

## Content System Tables (in Content Scheduler base — P501bI8KwaKvT7siDrZukMrWtAf)
- `tbl0nohouA9DLx2D` — **Content Pipeline** (Title, Topic, Angle, Hook Type, Status, Seller, Hook, Script, CTA, Caption, Filming Notes, Media URL, Scheduled Date)
- `tblXouaMoDRhLMaa` — **Hook Database** (Hook text in `多行文本` primary field, Framework, Category, Avg Views, Source, Platform — 28 starter hooks seeded)

## Lark Infrastructure (Three Bases)

### 1. Automate Everything v2 — Seller Content Ops
App token: `AjW5bgC4TaAehfsfCxru9Muxtwx`
URL: https://cedw5xj2shl.usttp.larksuite.com/base/AjW5bgC4TaAehfsfCxru9Muxtwx

Key tables:
- `tblhRIdrum4EdpHi` — **Sellers** (brand profiles, contacts, KPIs, voice, doc links)
- `tblrVkT5bwbKurZz` — **Creators**
- `tblatIoiy7ulMM6s` — **Campaigns**
- `tblrWL22VDDhRdir` — **Videos** (performance log: Views, CVR, GMV, Hook Score)
- `tblP7OV6Mj2IKFZY` — **Products**

### 2. Operations — Agency Internal Ops
App token: `IGtFbXL6Ia5svAsL7c3uf03osSc`
URL: https://cedw5xj2shl.usttp.larksuite.com/base/IGtFbXL6Ia5svAsL7c3uf03osSc

Key tables:
- `tbll2rBcIkaQwg1j` — **Clients** (seller status: Launched / Onboarding)
- `tbl2tNDlntQjwwUP` — **The Cult** (team: Tommy, Nate, Hasan, Mansoor, Gilbert, Owen, Hillary)

### 3. Content Scheduler Queue — The Posting Queue
App token: `P501bI8KwaKvT7siDrZukMrWtAf`
Table ID: `tbl4nbkFlFIyz2Nl`

This is what `scheduler.js` reads from. Fields:
- `Content` — post caption
- `Media URL` — Google Drive direct link (format: `{text, link}`)
- `Platforms` — multi-select: TikTok, Instagram, Facebook, LinkedIn, X (Twitter), YouTube, Discord, Skool
- `Content Type` — Short Form Video / Image / Story / Reel
- `Status` — Ready → Scheduled / Failed
- `Scheduled Date` — Unix timestamp in ms
- `Notes` — scheduler error/success logs
- `Posted Via` — GHL or PhantomBuster

## Platform → GHL Account ID Mapping

```javascript
Facebook:     '6844f30f0174c68525080f02_..._253831741137264_page'
Instagram:    ['69c5264d...', '6844f2e6...']  // two accounts: tommy.lynch_ + cultcontent.cc
LinkedIn:     '6844f368..._90423633_page'
TikTok:       '6844f386..._business'
YouTube:      '6844f39f..._profile'
'X (Twitter)': '__phantombuster__'
Discord:      '__manual__'
Skool:        '__manual__'
```

## Environment Variables (.env)
- `LARK_APP_ID` / `LARK_APP_SECRET` — for the Content Scheduler Queue base
- `LARK_BITABLE_APP_TOKEN` — `P501bI8KwaKvT7siDrZukMrWtAf`
- `LARK_BITABLE_TABLE_ID` — `tbl4nbkFlFIyz2Nl`
- `LARK_ALERT_CHAT_ID` — Lark chat ID for reconnect alerts
- `GHL_API_KEY` / `GHL_LOCATION_ID` / `GHL_BASE_URL`
- `PHANTOM_API_KEY` / `PHANTOM_AGENT_ID` / `PHANTOM_SESSION_COOKIE`
- `RECONNECT_WARNING_DAYS` — days before token expiry to alert (default 7)

**Important:** `PHANTOM_SESSION_COOKIE` must match the `auth_token` cookie at x.com. This cookie expires periodically — when PhantomBuster sends an error about missing cookie, get a fresh one from Chrome DevTools → Application → Cookies → x.com, update `.env` AND update it in PhantomBuster's agent setup page.

## Current Active Clients (7 launched)
Jinfiniti, Xooma, Wild Society Nutrition, Bayside, Lion Spice Co., The Perfect Haircare, Tropical Oasis

## Skills (In Development)
Skill files live in `skills/` and are also installed globally at `~/.claude/skills/`.

- `skills/cult-ideator.md` — generates content ideas → writes to Content Pipeline
- `skills/cult-scripter.md` — scripts ideas → writes filming cards back to Lark
- `skills/cult-analysis.md` — analyzes post performance (Phase 2, after analytics sync)

## Project Scope
See `PROJECT_SCOPE.md` for full vision, architecture decisions, build order, and open questions.
