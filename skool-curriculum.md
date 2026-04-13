# Cult Content — Skool Group Curriculum
**Group:** https://www.skool.com/cult-content

The Cult Content Skool community teaches TikTok Shop sellers how to build an automated AI content system. Sellers who go through this can handle their own content, or get upsold into full agency management.

---

## 🎯 The Transformation

**Before:** Spending 10+ hours/week manually filming, editing, captioning, scheduling content.
**After:** A system that generates scripts, creates videos, and posts automatically — while you focus on your shop.

---

## 📚 Module Structure

---

### MODULE 1 — The System (Start Here)
*The big picture. What you're building and why it works.*

**Lesson 1.1 — Why Most TikTok Shops Fail at Content**
- The hamster wheel problem: volume without system = burnout
- Why the algorithm rewards consistency, not perfection
- The 3-layer content machine: creation → scheduling → posting

**Lesson 1.2 — System Overview: How It All Connects**
- Lark (your content brain / calendar)
- Arcads (AI video generation)
- Buffer (automated posting to every platform)
- Claude (scripts, ideas, editing)
- The scheduler (the glue that runs it all)
- Diagram: full pipeline from idea → live post

**Lesson 1.3 — What You Need to Get Started**
- Accounts to set up (Lark, Buffer, Arcads, Claude Code)
- Platforms to connect (TikTok, Instagram, YouTube, LinkedIn)
- Estimated time: 2 hours to set up, 30 min/week to run

**Lesson 1.4 — Your First Post (Quick Win)**
- Drop a video into Lark
- Set Status = Ready
- Watch it post automatically
- Proof the system works before going deep

---

### MODULE 2 — Your Content Calendar in Lark
*The brain of the operation. Where everything lives.*

**Lesson 2.1 — Setting Up Your Lark Base**
- Creating your Content Scheduler Queue table
- Required fields: Content, Media URL, Platforms, Scheduled Date, Status
- How to clone the Cult Content template

**Lesson 2.2 — How the Queue Works**
- Status flow: Draft → Ready → Posted
- How the scheduler picks up "Ready" records every 15 minutes
- Google Drive links work — system auto-converts to CDN

**Lesson 2.3 — Planning Your Content Calendar**
- Batching: film/generate once, post for a week
- Recommended posting frequency per platform
- How to stagger posts so you're not flooding your feed

**Lesson 2.4 — Platform Routing**
- Which platforms to use for which content types
- CC brand vs personal account rules
- Multi-platform in one record

---

### MODULE 3 — AI Video Generation with Arcads
*Make videos without filming anything.*

**Lesson 3.1 — What Arcads Does**
- UGC-style AI actors talking to camera
- Why "cute girl" hooks work for cold traffic
- When to use AI video vs real footage

**Lesson 3.2 — Writing Scripts That Convert**
- The 5 hook frameworks (curiosity, pain, vision, insider, reframe)
- Script length for TikTok/Reels (30-45 seconds)
- The comment CTA funnel: "comment X and I'll send you the link"
- Testing: 5 scripts × 8 actors = 40 videos, find what works

**Lesson 3.3 — Running the Arcads Workflow**
- Picking your actors (situations library)
- Creating a script batch via the API
- Running `node arcads-poller.js --watch` to auto-queue
- How to scale: one strong script → 8 actors → 40 test videos

**Lesson 3.4 — Adding B-Roll (Coming Soon)**
- What b-roll does for watch time
- Auto-generating scene prompts from your script
- Stitching b-roll + talking head with FFmpeg

---

### MODULE 4 — Automated Posting via Buffer
*Set it and forget it.*

**Lesson 4.1 — Connecting Your Accounts to Buffer**
- Instagram, TikTok, YouTube, LinkedIn, Facebook, X
- Brand accounts vs personal accounts — keep them separate
- What each platform needs (Instagram needs reel metadata, YouTube needs title)

**Lesson 4.2 — How the Scheduler Posts**
- Buffer GraphQL API under the hood
- How video URLs flow from Lark → scheduler → Buffer → live
- What happens when a post fails (retry logic, error notes in Lark)

**Lesson 4.3 — Deploying to Railway (Never Turn Off Your Laptop)**
- Fork the GitHub repo
- Connect to Railway
- Add your env vars
- Your system now runs 24/7 from the cloud

**Lesson 4.4 — Monitoring & Troubleshooting**
- How to read Lark "Notes" field for post status
- Common errors and fixes
- How to check what's queued in Buffer

---

### MODULE 5 — Comment AI & Engagement Automation
*Turn comments into leads automatically.*

**Lesson 5.1 — The Comment Funnel**
- Why "comment X" beats "link in bio"
- The flow: video → comment → DM → link → join
- What platforms allow comment automation

**Lesson 5.2 — Setting Up Comment AI**
*(Platform TBD — Tommy sourcing best tool)*
- Triggering DMs when someone comments the keyword
- What the DM should say
- Handling follow-up messages

**Lesson 5.3 — Measuring What's Working**
- Which scripts get the most comments
- Which actors perform best
- Double down on winners, cut losers

---

### MODULE 6 — Claude as Your Content Team
*Using AI to ideate, script, and edit — without prompting from scratch.*

**Lesson 6.1 — The `/cult-ideator` Skill**
- Give it a product or topic
- Get 5 video angles written to your Lark Content Pipeline
- How to install and run Claude Code skills

**Lesson 6.2 — The `/cult-scripter` Skill**
- Takes a Draft idea from Lark
- Writes full filming card: hook + script + CTA + caption
- Saves back to Lark automatically

**Lesson 6.3 — Video Editing with `/cult-editor`**
- For polished, multi-clip content
- Long-form processing: silence detection, auto-cuts, captions burned in
- When to use AI editing vs Arcads vs manual

---

### MODULE 7 — Scaling & Replication
*Build once. Run for multiple clients or shops.*

**Lesson 7.1 — Running the System for Multiple Sellers**
- One Lark workspace per seller (cloned from master template)
- How to keep each seller's content isolated
- Agency model: you manage 7+ shops from one Claude Code setup

**Lesson 7.2 — The Agency Template**
- How to fork the repo for a new client
- `.env.example` walkthrough
- Getting a client live in under 2 hours

**Lesson 7.3 — What to Charge**
- Pricing the automation as a service
- The upsell path: Skool → DIY → agency management

---

## 🗺️ Recommended Learning Path

| Week | Focus | Outcome |
|------|-------|---------|
| 1 | Modules 1–2 | System set up, first post automated |
| 2 | Module 3 | First Arcads batch generated and queued |
| 3 | Module 4 | Fully deployed on Railway, posting 24/7 |
| 4 | Module 5 | Comment funnel live, leads coming in |
| 5+ | Modules 6–7 | Claude skills, scaling to more content |

---

## 📎 Downloads

*(Each lesson links to the relevant skill file or template)*

- `cult-ideator.md` — Claude Code skill for video ideation
- `cult-scripter.md` — Claude Code skill for script writing
- `lark-template` — Content Scheduler Queue base template
- `.env.example` — Environment variable template
- `arcads-poller.js` — Arcads video auto-queue script
- `scheduler.js` — Main automation scheduler

---

*Questions? Post in the community. Tommy and the team respond daily.*
