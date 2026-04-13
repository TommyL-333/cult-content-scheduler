/**
 * Cult Content Scheduler
 * Reads Lark Bitable "Content Queue", posts via GHL + PhantomBuster,
 * and alerts on expiring/expired social account tokens.
 *
 * Run: node scheduler.js
 * Watch mode: node scheduler.js --watch   (checks every 15 minutes)
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FormData = require('form-data');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CFG = {
  lark: {
    appId:       process.env.LARK_APP_ID,
    appSecret:   process.env.LARK_APP_SECRET,
    baseUrl:     'https://open.larksuite.com/open-apis',
    appToken:    process.env.LARK_BITABLE_APP_TOKEN,
    tableId:     process.env.LARK_BITABLE_TABLE_ID,
    alertChatId: process.env.LARK_ALERT_CHAT_ID || null,
  },
  ghl: {
    apiKey:     process.env.GHL_API_KEY,
    locationId: process.env.GHL_LOCATION_ID,
    baseUrl:    process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com',
  },
  phantom: {
    apiKey:         process.env.PHANTOM_API_KEY || null,
    agentId:        process.env.PHANTOM_AGENT_ID || null,
    sessionCookie:  process.env.PHANTOM_SESSION_COOKIE || null,
  },
  buffer: {
    apiKey:   process.env.BUFFER_API_KEY || null,
    endpoint: 'https://api.buffer.com',
  },
  reconnectWarningDays: parseInt(process.env.RECONNECT_WARNING_DAYS || '7', 10),
  watchIntervalMs: 15 * 60 * 1000, // 15 minutes
};

// Platform label (from Lark multi-select) → GHL account ID or Buffer routing token.
// Keys match the Lark Bitable "Platforms" multi-select option names exactly.
// Cult Content TikTok stays on GHL until connected to Buffer. Tommy TikTok now on Buffer.
const PLATFORM_ACCOUNTS = {
  // ── Cult Content brand accounts (CC only) ────────────────────────────────
  'CC Instagram':   '__buffer_instagram_cc__',     // cultcontent.cc IG only
  'CC YouTube':     '__buffer_youtube_cc__',        // Cult Content YT only
  'CC LinkedIn':    '__buffer_linkedin__',          // Cult Content LinkedIn
  'CC Facebook':    '__buffer_facebook__',          // Cult Content Facebook
  'CC X':           '__buffer_x__',                // Cult Content X
  // ── Legacy names (both CC + Tommy) — keep for backwards compat ──────────
  Instagram:        '__buffer_instagram__',         // cultcontent.cc + tommy.lynch_
  Facebook:         '__buffer_facebook__',          // Cult Content page
  LinkedIn:         '__buffer_linkedin__',          // Cult Content LinkedIn page
  YouTube:          '__buffer_youtube__',           // both YT channels
  'X (Twitter)':    '__buffer_x__',                // thlynch3
  // ── Tommy personal accounts ──────────────────────────────────────────────
  'Tommy Instagram':'__buffer_instagram_tommy__',   // tommy.lynch_ only
  'Tommy LinkedIn': '__buffer_linkedin_tommy__',    // Tommy Lynch personal profile
  'Tommy YouTube':  '__buffer_youtube_tommy__',     // Tommy Lynch YT only
  'Tommy TikTok':   '__buffer_tiktok_tommy__',      // tommylynch_ via Buffer
  'Tommy X':        '__buffer_x__',                // thlynch3
  // ── GHL-routed (Cult Content business TikTok) ────────────────────────────
  TikTok:          '6844f386af761628a88a0049_c216j58Vx9XxYa7WYMiA_000o3Vtks8AR8BeWyB1AIxSgm9YXhQoY81Y_business',
  // ── Manual ────────────────────────────────────────────────────────────────
  Discord:          '__manual__',
  Skool:            '__manual__',
};

// Buffer channel ID map — routing token → array of Buffer channel IDs to post to
const BUFFER_CHANNEL_MAP = {
  // CC-only singles
  '__buffer_instagram_cc__':    [process.env.BUFFER_IG_CULT_ID              || '69d70072031bfa423ce3fc25'],
  '__buffer_youtube_cc__':      [process.env.BUFFER_YOUTUBE_CULT_CONTENT_ID || '69d6de07031bfa423ce366fa'],
  // Both CC + Tommy
  '__buffer_youtube__':         [
    process.env.BUFFER_YOUTUBE_CULT_CONTENT_ID || '69d6de07031bfa423ce366fa',
    process.env.BUFFER_YOUTUBE_TOMMY_ID        || '69d6de1e031bfa423ce368be',
  ],
  '__buffer_youtube_tommy__':   [process.env.BUFFER_YOUTUBE_TOMMY_ID        || '69d6de1e031bfa423ce368be'],
  '__buffer_instagram__':       [
    process.env.BUFFER_IG_CULT_ID    || '69d70072031bfa423ce3fc25',
    process.env.BUFFER_IG_TOMMY_ID   || '69d6de31031bfa423ce369cf',
  ],
  '__buffer_instagram_tommy__': [process.env.BUFFER_IG_TOMMY_ID             || '69d6de31031bfa423ce369cf'],
  '__buffer_linkedin__':        [process.env.BUFFER_LI_CULT_ID              || '69d70096031bfa423ce3fca1'],
  '__buffer_linkedin_tommy__':  [process.env.BUFFER_LI_TOMMY_ID             || '69d700d7031bfa423ce3fd6f'],
  '__buffer_facebook__':        [process.env.BUFFER_FACEBOOK_CULT_ID        || '69d70154031bfa423ce3fefa'],
  '__buffer_x__':               [process.env.BUFFER_X_ID                    || '69d7018f031bfa423ce3ffa5'],
  '__buffer_tiktok_tommy__':    [process.env.BUFFER_TIKTOK_TOMMY_ID         || '69d7f3cd031bfa423ce82b4a'],
};

// YouTube channel IDs — these need YouTube-specific metadata in the mutation
const BUFFER_YOUTUBE_CHANNEL_IDS = new Set([
  process.env.BUFFER_YOUTUBE_CULT_CONTENT_ID || '69d6de07031bfa423ce366fa',
  process.env.BUFFER_YOUTUBE_TOMMY_ID        || '69d6de1e031bfa423ce368be',
]);

// ─────────────────────────────────────────────────────────────────────────────
// LARK CLIENT
// ─────────────────────────────────────────────────────────────────────────────
let _larkToken = null;
let _larkTokenExpiry = 0;

async function getLarkToken() {
  if (_larkToken && Date.now() < _larkTokenExpiry) return _larkToken;
  const res = await axios.post(`${CFG.lark.baseUrl}/auth/v3/tenant_access_token/internal`, {
    app_id: CFG.lark.appId,
    app_secret: CFG.lark.appSecret,
  });
  _larkToken = res.data.tenant_access_token;
  _larkTokenExpiry = Date.now() + (res.data.expire - 60) * 1000;
  return _larkToken;
}

async function larkReq(method, path, body) {
  const token = await getLarkToken();
  const res = await axios({ method, url: `${CFG.lark.baseUrl}${path}`, data: body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (res.data.code !== 0 && res.data.code !== undefined) {
    throw new Error(`Lark API error ${res.data.code}: ${res.data.msg}`);
  }
  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// BITABLE OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────
async function getReadyPosts() {
  const res = await larkReq('POST',
    `/bitable/v1/apps/${CFG.lark.appToken}/tables/${CFG.lark.tableId}/records/search`,
    {
      filter: {
        conjunction: 'and',
        conditions: [{
          field_name: 'Status',
          operator: 'is',
          value: ['Ready'],
        }],
      },
      page_size: 50,
    }
  );
  return res.data?.items || [];
}

async function updateRecord(recordId, fields) {
  await larkReq('PUT',
    `/bitable/v1/apps/${CFG.lark.appToken}/tables/${CFG.lark.tableId}/records/${recordId}`,
    { fields }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GHL CLIENT
// ─────────────────────────────────────────────────────────────────────────────
const ghl = axios.create({
  baseURL: CFG.ghl.baseUrl,
  headers: {
    Authorization: `Bearer ${CFG.ghl.apiKey}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  },
});

async function ghlGetAccounts() {
  const res = await ghl.get(`/social-media-posting/${CFG.ghl.locationId}/accounts`);
  return res.data?.results?.accounts || [];
}

async function ghlCreatePost({ accountIds, summary, mediaUrl, scheduleDate, postType = 'post' }) {
  const body = {
    accountIds,
    userId: CFG.ghl.locationId,
    summary,
    type: postType,
    status: 'scheduled',
    scheduleDate: new Date(scheduleDate).toISOString(),
    media: [],
  };
  if (mediaUrl) {
    // Detect video vs image by extension
    const isVideo = /\.(mp4|mov|avi|webm)$/i.test(mediaUrl);
    body.media = [{ url: mediaUrl, type: isVideo ? 'video/mp4' : 'image/jpeg' }];
  }
  const res = await ghl.post(`/social-media-posting/${CFG.ghl.locationId}/posts`, body);
  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHANTOMBUSTER CLIENT
// ─────────────────────────────────────────────────────────────────────────────
async function phantomPost({ summary, mediaUrl }) {
  if (!CFG.phantom.apiKey || !CFG.phantom.agentId) {
    throw new Error('PhantomBuster not configured (set PHANTOM_API_KEY + PHANTOM_AGENT_ID in .env)');
  }
  const res = await axios.post(
    'https://api.phantombuster.com/api/v2/agents/launch',
    {
      id: CFG.phantom.agentId,
      argument: JSON.stringify({ sessionCookie: CFG.phantom.sessionCookie, text: summary, imageUrl: mediaUrl || '' }),
    },
    { headers: { 'X-Phantombuster-Key': CFG.phantom.apiKey } }
  );
  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA URL RESOLVER
// Detects Google Drive links, downloads, compresses with FFmpeg, uploads to
// GHL CDN, and returns a stable filesafe.space URL. Falls through for all
// other URLs. Lark records are updated with the CDN URL so re-runs are instant.
// ─────────────────────────────────────────────────────────────────────────────
const { spawnSync } = require('child_process');
const IS_WINDOWS = process.platform === 'win32';
// On Linux (Railway/cloud) and Mac, ffmpeg is on PATH.
// On Windows, use the WinGet-installed binary.
const FFMPEG_BIN = IS_WINDOWS
  ? 'C:\\Users\\thlyn\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe'
  : 'ffmpeg';

function extractDriveFileId(url) {
  if (!url) return null;
  const ucMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (ucMatch) return ucMatch[1];
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if (fileMatch) return fileMatch[1];
  return null;
}

function isDriveUrl(url) {
  return !!(url && (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')));
}

async function downloadDriveFile(fileId, destPath) {
  const downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  const res = await axios.get(downloadUrl, { responseType: 'stream', timeout: 180000 });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  const size = fs.statSync(destPath).size;
  if (size < 10000) throw new Error(`Download too small (${size} bytes) — file may not be public`);
  return size;
}

function compressForCdn(inputPath, outputPath) {
  // Target ~20MB: 720p, 2Mbps video + 128kbps audio — good quality for social
  const result = spawnSync(FFMPEG_BIN, [
    '-y', '-i', inputPath,
    '-vf', 'scale=-2:720',
    '-c:v', 'libx264', '-b:v', '2000k', '-maxrate', '2500k', '-bufsize', '4000k',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ], { timeout: 300000, stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(`FFmpeg failed: ${result.stderr?.toString().slice(-300)}`);
  }
}

async function uploadToGhlCdn(filePath, filename) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), { filename, contentType: 'video/mp4' });
  form.append('altId', CFG.ghl.locationId);
  form.append('altType', 'location');

  const uploadRes = await axios.post(
    `${CFG.ghl.baseUrl}/medias/upload-file`, form,
    {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${CFG.ghl.apiKey}`, Version: '2021-07-28' },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 300000,
    }
  );
  const cdnUrl = uploadRes.data?.data?.url || uploadRes.data?.url;
  if (!cdnUrl) throw new Error(`GHL CDN upload returned no URL: ${JSON.stringify(uploadRes.data)}`);
  return cdnUrl;
}

// Cache Drive fileId → CDN URL within a single run
const _cdnCache = {};

async function resolveMediaUrl(url) {
  if (!isDriveUrl(url)) return url;
  const fileId = extractDriveFileId(url);
  if (!fileId) return url;
  if (_cdnCache[fileId]) {
    log(`     ↑ CDN cache hit for ${fileId}`);
    return _cdnCache[fileId];
  }

  log(`     ↑ Google Drive URL detected — downloading & transcoding to CDN...`);
  const rawPath = path.join(os.tmpdir(), `cult_raw_${fileId}.mp4`);
  const compPath = path.join(os.tmpdir(), `cult_cdn_${fileId}.mp4`);

  try {
    const bytes = await downloadDriveFile(fileId, rawPath);
    const mb = (bytes / 1024 / 1024).toFixed(1);
    log(`     ↑ Downloaded ${mb}MB — compressing for CDN...`);

    await compressForCdn(rawPath, compPath);
    const compMb = (fs.statSync(compPath).size / 1024 / 1024).toFixed(1);
    log(`     ↑ Compressed to ${compMb}MB — uploading to GHL CDN...`);

    const cdnUrl = await uploadToGhlCdn(compPath, `cult-content-${fileId}.mp4`);
    log(`     ✓ CDN URL: ${cdnUrl}`);
    _cdnCache[fileId] = cdnUrl;
    return cdnUrl;
  } finally {
    [rawPath, compPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUFFER CLIENT
// ─────────────────────────────────────────────────────────────────────────────
async function bufferGraphQL(query, variables = {}) {
  if (!CFG.buffer.apiKey) throw new Error('BUFFER_API_KEY not set in .env');
  const res = await axios.post(
    CFG.buffer.endpoint,
    { query, variables },
    { headers: { Authorization: `Bearer ${CFG.buffer.apiKey}`, 'Content-Type': 'application/json' } }
  );
  if (res.data.errors) throw new Error(`Buffer API: ${res.data.errors[0].message}`);
  return res.data.data;
}

// Post to a single Buffer channel. YouTube channels get metadata automatically.
async function bufferPostToChannel({ channelId, summary, mediaUrl, scheduleDate, title }) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id dueAt } }
        ... on MutationError { message }
      }
    }
  `;

  const input = {
    text:           summary,
    channelId,
    schedulingType: 'automatic',
    mode:           'customScheduled',
    dueAt:          new Date(scheduleDate).toISOString(),
  };

  if (mediaUrl) {
    input.assets = { videos: [{ url: mediaUrl }] };
  }

  const INSTAGRAM_CHANNEL_IDS = new Set([
    process.env.BUFFER_IG_CULT_ID  || '69d70072031bfa423ce3fc25',
    process.env.BUFFER_IG_TOMMY_ID || '69d6de31031bfa423ce369cf',
  ]);

  if (BUFFER_YOUTUBE_CHANNEL_IDS.has(channelId) && title) {
    input.metadata = { youtube: { title: title.slice(0, 100), privacy: 'public', notifySubscribers: true, categoryId: '27' } };
  } else if (INSTAGRAM_CHANNEL_IDS.has(channelId)) {
    input.metadata = { instagram: { type: 'reel', shouldShareToFeed: true } };
  }

  const data = await bufferGraphQL(mutation, { input });
  const result = data?.createPost;
  if (result?.message) throw new Error(result.message);
  return result?.post;
}

// ─────────────────────────────────────────────────────────────────────────────
// RECONNECT ALERTS
// ─────────────────────────────────────────────────────────────────────────────
async function checkAccountHealth() {
  const accounts = await ghlGetAccounts();
  const now = Date.now();
  const warnMs = CFG.reconnectWarningDays * 86400 * 1000;
  const reconnectUrl = `https://app.profitibull.com/v2/location/${CFG.ghl.locationId}/social-planner/accounts`;

  // Skip YouTube — it's now handled by Buffer and its GHL token always shows
  // as "expiring soon" due to Google's short OAuth window (false positive).
  const SKIP_PLATFORMS = ['youtube'];

  const issues = [];
  for (const acct of accounts) {
    if (SKIP_PLATFORMS.includes(acct.platform?.toLowerCase())) continue;
    const expiry = new Date(acct.expire).getTime();
    const daysLeft = Math.floor((expiry - now) / 86400000);
    if (acct.isExpired) {
      issues.push({ acct, label: '🔴 EXPIRED', daysLeft: 0 });
    } else if (expiry - now < warnMs) {
      issues.push({ acct, label: `🟡 Expires in ${daysLeft}d`, daysLeft });
    }
  }

  if (issues.length === 0) {
    log('✓ All accounts healthy');
    return;
  }

  for (const { acct, label } of issues) {
    log(`  ${label}: ${acct.platform} / ${acct.name}`);
  }

  if (!CFG.lark.alertChatId) {
    log('  ↳ No LARK_ALERT_CHAT_ID set — skipping Lark alert');
    return;
  }

  const lines = issues.map(({ acct, label }) =>
    `${label} — ${acct.platform} (${acct.name})`);

  const text = [
    '⚠️ Social Account Reconnection Required',
    '',
    ...lines,
    '',
    `👉 Reconnect: ${reconnectUrl}`,
  ].join('\n');

  await larkReq('POST', '/im/v1/messages?receive_id_type=chat_id', {
    receive_id: CFG.lark.alertChatId,
    msg_type: 'text',
    content: JSON.stringify({ text }),
  });
  log('  ✓ Reconnect alert sent via Lark');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST FIELD HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function extractText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) return field.map(f => f.text || f).join('');
  return String(field);
}

function extractPlatforms(field) {
  if (!field) return [];
  if (Array.isArray(field)) return field.map(f =>
    typeof f === 'string' ? f : (f.value || f.text || f.name || ''));
  return [];
}

function extractUrl(field) {
  if (!field) return null;
  if (typeof field === 'string') return field;
  if (field.link) return field.link;
  if (field.url) return field.url;
  return null;
}

function mapContentTypeToPostType(contentType) {
  const ct = extractText(contentType).toLowerCase();
  if (ct.includes('reel') || ct.includes('short')) return 'reel';
  if (ct.includes('story')) return 'story';
  return 'post';
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS A SINGLE POST
// ─────────────────────────────────────────────────────────────────────────────
async function processPost(record) {
  const { record_id: recordId, fields } = record;
  const summary = extractText(fields['Content']);
  const rawMediaUrl = extractUrl(fields['Media URL']);
  const scheduleDate = fields['Scheduled Date'];
  const platforms = extractPlatforms(fields['Platforms']);
  const postType = mapContentTypeToPostType(fields['Content Type']);

  // Resolve Google Drive URLs → GHL CDN before posting
  let mediaUrl = rawMediaUrl;
  if (rawMediaUrl && isDriveUrl(rawMediaUrl)) {
    try {
      mediaUrl = await resolveMediaUrl(rawMediaUrl);
      // Update the Lark record with the CDN URL so future runs skip re-upload
      if (mediaUrl !== rawMediaUrl) {
        await updateRecord(recordId, { 'Media URL': { link: mediaUrl, text: mediaUrl } });
        log(`     ✓ Lark Media URL updated to CDN`);
      }
    } catch (err) {
      log(`     ⚠ Media URL resolution failed: ${err.message} — using original URL`);
    }
  }

  log(`\n  📄 "${summary.slice(0, 60)}${summary.length > 60 ? '…' : ''}"`);
  log(`     Platforms: ${platforms.join(', ')} | Type: ${postType} | Sched: ${new Date(scheduleDate).toLocaleString()}`);

  const ghlAccountIds = [];
  const bufferChannelIds = new Set();
  const manualPlatforms = [];

  for (const p of platforms) {
    const id = PLATFORM_ACCOUNTS[p];
    if (!id) {
      log(`     ⚠ Unknown platform "${p}" — skipped`);
    } else if (id === '__manual__') {
      manualPlatforms.push(p);
    } else if (id.startsWith('__buffer_')) {
      (BUFFER_CHANNEL_MAP[id] || []).forEach(ch => bufferChannelIds.add(ch));
    } else if (Array.isArray(id)) {
      ghlAccountIds.push(...id);
    } else {
      ghlAccountIds.push(id);
    }
  }

  if (manualPlatforms.length) log(`     ℹ Manual (no automation): ${manualPlatforms.join(', ')}`);

  const errors = [];
  const successVia = [];

  // ── GHL (TikTok only) ──────────────────────────────────────────────────────
  if (ghlAccountIds.length > 0) {
    try {
      const res = await ghlCreatePost({ accountIds: ghlAccountIds, summary, mediaUrl, scheduleDate, postType });
      log(`     ✓ GHL: queued post id=${res.post?._id || res._id || '?'} for ${ghlAccountIds.length} account(s)`);
      successVia.push('GHL');
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      log(`     ✗ GHL failed: ${msg}`);
      errors.push(`GHL: ${msg}`);
    }
  }

  // ── Buffer (Instagram, Facebook, LinkedIn, YouTube, X) ────────────────────
  if (bufferChannelIds.size > 0) {
    const title = extractText(fields['Title']) || summary.split('\n')[0].slice(0, 100);
    for (const channelId of bufferChannelIds) {
      try {
        const post = await bufferPostToChannel({ channelId, summary, mediaUrl, scheduleDate, title });
        log(`     ✓ Buffer (${channelId}): scheduled at ${post?.dueAt}`);
        if (!successVia.includes('Buffer')) successVia.push('Buffer');
      } catch (err) {
        log(`     ✗ Buffer (${channelId}): ${err.message}`);
        errors.push(`Buffer(${channelId}): ${err.message}`);
      }
    }
  }

  // ── Update Lark ────────────────────────────────────────────────────────────
  const hasAnySuccess = successVia.length > 0;
  const hasAnyFailure = errors.length > 0;

  let newStatus, notes;
  if (hasAnySuccess && !hasAnyFailure) {
    newStatus = 'Scheduled';
    notes = `Queued via ${successVia.join(', ')} on ${new Date().toISOString()}`;
  } else if (hasAnySuccess && hasAnyFailure) {
    newStatus = 'Scheduled';
    notes = `Partial — ${successVia.join(', ')} OK. Errors: ${errors.join('; ')}`;
  } else {
    newStatus = 'Failed';
    notes = errors.join('; ') || 'No platforms queued';
  }

  const updateFields = { Status: newStatus, Notes: notes };
  if (successVia.length) {
    const viaLabel = successVia.includes('Buffer') && successVia.includes('GHL') ? 'GHL + Buffer'
      : successVia.includes('Buffer') ? 'Buffer'
      : 'GHL';
    updateFields['Posted Via'] = viaLabel;
  }

  try {
    await updateRecord(recordId, updateFields);
    log(`     ✓ Lark → ${newStatus}`);
  } catch (err) {
    log(`     ✗ Lark update failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RUN
// ─────────────────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(msg);
}

async function run() {
  log(`\n${'─'.repeat(60)}`);
  log(`[${new Date().toISOString()}] Cult Content Scheduler`);
  log('─'.repeat(60));

  // 1. Account health check
  log('\n📡 Account health check...');
  try {
    await checkAccountHealth();
  } catch (err) {
    log(`  ✗ Health check failed: ${err.message}`);
  }

  // 2. Fetch ready posts
  log('\n📋 Fetching ready posts...');
  let posts;
  try {
    posts = await getReadyPosts();
  } catch (err) {
    log(`  ✗ Could not fetch posts: ${err.message}`);
    return;
  }

  if (posts.length === 0) {
    log('  No posts with Status=Ready found.');
    return;
  }
  log(`  Found ${posts.length} post(s) to process`);

  // 3. Process each
  for (const post of posts) {
    try {
      await processPost(post);
    } catch (err) {
      log(`  ✗ Unhandled error on record ${post.record_id}: ${err.message}`);
      try { await updateRecord(post.record_id, { Status: 'Failed', Notes: err.message }); } catch {}
    }
  }

  log('\n✅ Run complete\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
const watchMode = process.argv.includes('--watch');

if (watchMode) {
  log(`Starting in watch mode (every ${CFG.watchIntervalMs / 60000} minutes)`);
  run();
  setInterval(run, CFG.watchIntervalMs);
} else {
  run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}
