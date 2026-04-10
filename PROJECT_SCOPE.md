# Cult Content — AI Content System: Project Scope

**Last Updated:** 2026-04-03
**Owner:** Tommy Lynch
**Status:** Planning → Build

---

## Vision

Build a fully automated, AI-powered content operations platform that:

1. **Serves Cult Content internally** — Tommy and team generate, script, and schedule content for all managed sellers from a single Lark workspace
2. **Becomes a product sold to sellers** — Self-serve version delivered through the Cult Content Skool group
3. **Becomes a product sold to agencies** — The full agency stack (Lark architecture + skills + scheduler) white-labeled for other TikTok Shop agencies to run for their own clients

The Skool group is the top of funnel. Sellers learn the system → some self-implement → the best get upsold into Cult Content managing it for them → the full agency system gets sold to other agencies.

---

## Current State (What's Already Built)

### Scheduler (`C:\Users\thlyn\cult-content-scheduler\`)
- Node.js script reads "Ready" records from Lark Content Queue
- Posts to Facebook, Instagram, TikTok, LinkedIn, YouTube via GHL
- Posts to X (Twitter) via PhantomBuster
- Discord and Skool marked as manual
- Runs manually (`node scheduler.js`) or on a 15-min watch loop
- `.env` holds all credentials: Lark, GHL, PhantomBuster

### Lark Infrastructure

**Base 1 — Automate Everything v2** (`AjW5bgC4TaAehfsfCxru9Muxtwx`)
*Seller content operations database*

| Table | Purpose |
|---|---|
| Sellers | Brand profiles, contacts, budgets, KPIs, doc links |
| Products | Product catalog per seller |
| Promo Strategy | Promotional planning |
| Creators | Creator roster |
| GMV Events | TikTok Shop GMV event tracking |
| Campaigns | Campaign management |
| Videos | Video performance log (Views, CVR, GMV, Hook Score) |
| Tasks | Task tracking |
| Seller Center Campaigns | TikTok Seller Center campaign data |

**Base 2 — Operations** (`IGtFbXL6Ia5svAsL7c3uf03osSc`)
*Agency internal ops*

| Table | Purpose |
|---|---|
| Clients | All seller/client records with status |
| The Cult | Team roster with roles, pillars, client assignments |
| Master Task Template | SOPs for recurring tasks |
| All Tasks | Full task log |
| Onboarding Task Creation | Auto-generates onboarding task sets |
| Active Task Creation | Auto-generates active management task sets |
| Daily/Weekly/Monthly Task Regenerator | Recurring task workflows |
| Task Assignment | Assigns tasks to team members |
| Affiliate Flyer Generation | Affiliate asset automation |

**Base 3 — Content Scheduler Queue** (`P501bI8KwaKvT7siDrZukMrWtAf`, table `tbl4nbkFlFIyz2Nl`)
*The posting queue the scheduler reads from*

| Field | Type | Purpose |
|---|---|---|
| Content | Text | Caption / post copy |
| Media URL | URL | Link to video/image in Google Drive |
| Platforms | Multi-select | TikTok, Instagram, Facebook, LinkedIn, X, YouTube, Discord, Skool |
| Content Type | Single-select | Short Form Video, Image, Story, etc. |
| Status | Single-select | Ready → Scheduled / Failed |
| Scheduled Date | DateTime | When to post |
| Notes | Text | Error logs, scheduler notes |
| Posted Via | Text | GHL or PhantomBuster |

### Current Clients (7 Active, 1 Onboarding)
Jinfiniti, Xooma, Wild Society Nutrition, Bayside, Lion Spice Co., The Perfect Haircare, Tropical Oasis
Onboarding: Oingo

### Team
Tommy Lynch (CTO/CMO), Nate Kim (Account Manager), Hasan, Mansoor Ahmad, Hillary (Affiliate Managers), Gilbert Conce (Video Editor), Owen (Video Poster)

---

## What We're Building

### The Three Use Cases

```
┌─────────────────────────────────────────────────────────┐
│  USE CASE 1: Cult Content Internal (Agency)             │
│  Tommy runs skills for all 7+ sellers from one place    │
│  Skills read seller voice/products from Lark            │
│  Output goes into Content Scheduler Queue               │
└─────────────────────────────────────────────────────────┘
                         ↓ template
┌─────────────────────────────────────────────────────────┐
│  USE CASE 2: Seller Self-Serve (Skool Product)          │
│  Seller has their own Lark workspace (cloned template)  │
│  Runs skills themselves via Claude Code desktop         │
│  Skool group has lesson guides + downloadable skills    │
└─────────────────────────────────────────────────────────┘
                         ↓ packaged system
┌─────────────────────────────────────────────────────────┐
│  USE CASE 3: Agency Template (B2B Product)              │
│  Full Lark architecture + skills + scheduler            │
│  Another agency installs it, manages their own sellers  │
└─────────────────────────────────────────────────────────┘
```

### Lark Architecture: One Template, Three Uses

**Option B (chosen):** One Lark workspace per seller, cloned from a master template.

```
Cult Content Lark Workspace
├── Automate Everything v2     ← all seller profiles live here (shared)
├── Operations                 ← agency team + task management
└── [per-seller workspaces]    ← each seller gets their own clone
    ├── Content Queue          ← the posting schedule (what scheduler reads)
    ├── Hook Database          ← proven hooks with view counts
    ├── Content Pipeline       ← ideas → scripted → filmed → posted
    └── Performance Log        ← post analytics (future)
```

For Cult Content internal: Tommy connects to each seller's workspace to run skills.
For seller self-serve: they run skills in their own workspace.
For agencies: same template, different seller names.

---

## Skills to Build

### Phase 1: Core Content System

---

#### `/cult-ideator`

**What it does:** Takes a topic or product, does research, generates 5+ video angle variations, and creates Draft records in the seller's Content Pipeline.

**Inputs:**
- Seller name or ID (used to pull their brand voice from Sellers table)
- Seed topic or product (e.g., "Lion Spice Co. — summer grilling rubs")
- Optional: number of variations (default 5)

**Process:**
1. Reads seller's Brand Mission, Target Audience, Competitors from Sellers table
2. Researches the topic (product benefits, competitor angles, trending hooks)
3. Generates N video concepts, each with: title, angle, hook type, target emotion
4. Presents options for Tommy (or seller) to approve
5. Pushes approved ideas to Content Pipeline table as Draft records

**Outputs:**
- Draft records in Content Pipeline with: Topic, Angle, Hook Type, Status=Draft
- Written confirmation of what was added

**Dependencies:**
- Seller profile in Automate Everything v2 Sellers table (Brand Mission, Target Audience fields)
- Content Pipeline table (new — needs to be created in each seller's workspace)
- Lark MCP (to write records)

**Lark fields needed in Content Pipeline:**
```
Title (Text)
Topic (Text)
Angle (Text)
Hook Type (Single-select: Curiosity / Pain / Result / Identity / Trend)
Status (Single-select: Idea / Scripting / Scripted / Filming / Filmed / Posted)
Seller (Link → Sellers)
Script (Long Text)
Caption (Long Text)
Hook (Text)
CTA (Text)
Media URL (URL)
Scheduled Date (DateTime)
Notes (Text)
```

---

#### `/cult-scripter`

**What it does:** Takes a Draft idea from the Content Pipeline, writes a full filming card (hook + script + CTA + caption), and saves it back to the record.

**Inputs:**
- Seller name or ID
- (Optional) Specific record to script, or Claude picks from Draft status records

**Process:**
1. Pulls Draft records from seller's Content Pipeline
2. Tommy (or seller) picks which idea to script
3. Claude reads:
   - Seller's brand voice (Brand Mission, Target Audience from Sellers table)
   - Hook database (to pick proven hook framework)
   - Product details (from Products table if relevant)
4. Presents 3 hook options for the chosen topic
5. Tommy picks a hook
6. Claude writes the full filming card:
   - **Hook** (first 3 seconds — the exact words to say)
   - **Script** (full spoken content, 30–60 seconds for short form)
   - **CTA** (what to say/show at the end)
   - **Caption** (platform-optimized, with hashtags, in brand voice)
   - **Filming notes** (angles, B-roll suggestions, text overlays)
7. Saves everything back to the Content Pipeline record, updates Status → Scripted

**Outputs:**
- Updated Content Pipeline record with Script, Hook, CTA, Caption filled in
- Printable filming card (displayed in Claude Code output)

**Dependencies:**
- Seller profile (Brand Mission & Story, Target Audience, Competitors)
- Hook Database table (new — see below)
- Content Pipeline table
- Products table (optional, for product-specific scripts)

---

#### Hook Database Table

A new Lark table (in the master template, shared or per-seller) storing proven hook frameworks.

**Fields:**
```
Hook Text (Text) — the actual hook
Framework (Single-select: Curiosity / Pain / Result / Identity / Trend / Contrast)
Category (Text) — e.g. "product reveal", "before/after", "mistake"
Avg Views (Number) — view count benchmark
Source (Single-select: Cult Content / Competitor / External)
Seller (Link → Sellers) — if seller-specific
Notes (Text)
```

Seed data: Start with 20–30 high-performing hook structures from existing content, then grow it.

---

### Phase 2: Analytics & Optimization (After First 21 Clips Post)

---

#### Performance Sync (n8n or Node script)

**What it does:** Pulls post performance data from GHL social analytics API daily, writes to Performance Log table in Lark.

**Why it matters:** Right now there's no feedback loop. After 21 clips go out, we need to know what's working to inform the next batch of ideas.

**Outputs into Performance Log:**
```
Post ID (Text)
Platform (Single-select)
Seller (Link → Sellers)
Views (Number)
Likes (Number)
Comments (Number)
Shares (Number)
CTR % (Number)
Posted At (DateTime)
Caption (Text)
Hook (Text) — manually tagged or extracted
```

---

#### `/cult-analysis`

**What it does:** Reads Performance Log for a seller, outputs a performance brief: what hooks are working, what topics get views, what formats to double down on.

**Outputs:**
- Top 5 performing hooks + view counts
- Best topics by average views
- Worst performing content (to avoid)
- 3 specific recommendations for next content batch

---

### Phase 3: Competitor Research (Future)

#### `/cult-competitor`

Pulls competitor content data, analyzes gaps vs. the seller's own content, identifies hooks and topics to steal.

---

## Build Order

### Sprint 1 — Foundation (Now)
- [ ] Create Content Pipeline table schema in Automate Everything v2
- [ ] Create Hook Database table with seed hooks
- [ ] Write `/cult-ideator` skill (`.md` file in `~/.claude/skills/`)
- [ ] Write `/cult-scripter` skill
- [ ] Test both skills on one real seller (Tommy's own content as first test)
- [ ] Add `Seller` field to Content Scheduler Queue (link to Sellers table)
- [ ] Update `CLAUDE.md` in scheduler project

### Sprint 2 — Multi-Seller (After First Test)
- [ ] Create "Seller Content Template" Lark workspace (the clone)
- [ ] Define which tables go in the template vs. stay centralized
- [ ] Test with second seller
- [ ] Document onboarding process: how to add a new seller to the system

### Sprint 3 — Analytics (After 21 Clips Post)
- [ ] Build GHL → Lark performance sync script
- [ ] Create Performance Log table
- [ ] Write `/cult-analysis` skill
- [ ] Run first analysis after clips go live

### Sprint 4 — Skool Product
- [ ] Record demo video for the Skool group
- [ ] Write lesson guides for each skill (NoeAI format)
- [ ] Publish `/cult-ideator` and `/cult-scripter` as downloadable `.md` files in Skool
- [ ] Create setup guide (Lark template + Claude Code install)

### Sprint 5 — Agency Product
- [ ] Package full system: Lark template + scheduler code + skills + setup guide
- [ ] Document agency onboarding SOP
- [ ] Price and productize

---

## File Structure

```
cult-content-scheduler/
├── .env                          ← credentials (never committed)
├── scheduler.js                  ← posting scheduler
├── CLAUDE.md                     ← context for Claude Code
├── PROJECT_SCOPE.md              ← this document
├── skills/
│   ├── cult-ideator.md           ← /cult-ideator skill
│   ├── cult-scripter.md          ← /cult-scripter skill
│   └── cult-analysis.md          ← /cult-analysis skill (Phase 2)
└── scripts/
    └── performance-sync.js       ← GHL → Lark analytics sync (Phase 2)
```

Skills also get installed globally at `~/.claude/skills/` for use in any Claude Code session.

---

## Project Management

### Where Things Live
| Asset | Location |
|---|---|
| This scope doc | `cult-content-scheduler/PROJECT_SCOPE.md` |
| Claude context | `cult-content-scheduler/CLAUDE.md` |
| Skill files | `cult-content-scheduler/skills/` + `~/.claude/skills/` |
| Seller data | Lark: Automate Everything v2 |
| Agency ops | Lark: Operations |
| Content queue | Lark: Content Scheduler Queue |
| Posting code | `cult-content-scheduler/scheduler.js` |

### Definition of Done (per skill)
A skill is "done" when:
1. The `.md` file is written and installed globally
2. It's been tested on at least one real seller
3. It writes/reads from Lark correctly
4. It's been documented in a Skool-ready lesson format

### Key Decisions Logged
- **Architecture:** Option B — one Lark workspace per seller (template-based), not one big shared workspace. Scales cleanly for both internal and self-serve use.
- **Posting:** GHL + PhantomBuster (already working). No need to switch to Zernio.
- **Storage:** Lark Bitable (already working). No need to add Supabase or Airtable.
- **Skool:** Sellers expected to have Claude Code desktop already set up.

---

## Open Questions

1. **Content Pipeline location:** Should it live in Automate Everything v2 (centralized) or in each seller's own workspace (decentralized)? Recommendation: start centralized in Automate Everything v2 with a Seller link field, migrate to per-seller later.

2. **Hook database:** One shared database across all sellers, or per-seller? Recommendation: one shared "master" hook database + allow seller-specific additions.

3. **Skool group URL:** Already set up — needs intro video recorded by Tommy.

4. **Brand voice per seller:** The scripter needs a voice/persona for each seller. This likely means adding a "Brand Voice" long-text field to the Sellers table, OR creating a `voice.md` file per seller that the skill reads.

5. **Tommy's own content (Cult Content brand):** Does Tommy want to script his OWN content (the 21 clips currently queued) using the scripter? If yes, this is the perfect first test case.
