/**
 * arcads-poller.js
 * Polls Arcads for completed videos → writes to Lark queue → scheduler posts via Buffer.
 * 
 * Usage:  node arcads-poller.js          (runs once)
 *         node arcads-poller.js --watch  (polls every 5 min until all done)
 */

require('dotenv').config();
const https = require('https');

const ARCADS_AUTH = 'Basic YzVjZWRmZTE1ZDM4NDljNmEyNDE3MzRjN2FlYmIzMDg6Xz5iYFBmQkJ9fmhKU0ZMRiVrWEZLbnRYPW53SitWMV9kUE1PfCJ9XQ==';
const ARCADS_BASE = 'https://external-api.arcads.ai';
const WATCH_MODE = process.argv.includes('--watch');
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Original script IDs from Apr 13 2026 generation run
const SCRIPTS = [
  { id: '613bd7fd-7f7f-4df6-9d2c-97236d24304f', name: 'Left Behind' },
  { id: '10815645-8142-4300-b9be-2d1cc4f0ada9', name: '20 Hours' },
  { id: '2fff39f3-ee4e-459d-9950-5adacaa074ec', name: 'The System' },
  { id: 'eadf2ddb-fbda-4a47-818e-4841fd12f4ed', name: "Nobody's Telling You" },
  { id: '2e0ecd68-da29-4e76-b8ea-bb75fc2e1c12', name: 'Stop Competing on Volume' },
];

// Post to Tommy's TikTok and Instagram
const PLATFORMS = ['Tommy TikTok', 'Tommy Instagram'];

// Track which video IDs we've already written to Lark (avoid dupes)
const alreadyPosted = new Set();

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(hostname, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ─── Lark ────────────────────────────────────────────────────────────────────

let _larkToken = null;
async function getLarkToken() {
  if (_larkToken) return _larkToken;
  const res = await httpsPost('open.larksuite.com', '/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: process.env.LARK_APP_ID,
    app_secret: process.env.LARK_APP_SECRET,
  });
  _larkToken = res.tenant_access_token;
  setTimeout(() => { _larkToken = null; }, 100 * 60 * 1000); // refresh after 100min
  return _larkToken;
}

async function larkCreateRecord(fields) {
  const token = await getLarkToken();
  return httpsPost(
    'open.larksuite.com',
    `/open-apis/bitable/v1/apps/${process.env.LARK_BITABLE_APP_TOKEN}/tables/${process.env.LARK_BITABLE_TABLE_ID}/records`,
    { fields },
    { Authorization: `Bearer ${token}` }
  );
}

// ─── Main poll ───────────────────────────────────────────────────────────────

// Stagger post times: first video posts in 2 hours, then every 4 hours
let nextPostOffset = 2 * 60 * 60 * 1000;

async function poll() {
  console.log(`\n[${new Date().toISOString()}] Polling Arcads...`);
  let totalDone = 0, totalPending = 0, newlyWritten = 0;

  for (const script of SCRIPTS) {
    const videos = await httpsGet(`${ARCADS_BASE}/v1/scripts/${script.id}/videos`, { Authorization: ARCADS_AUTH });
    const items = videos.items || [];

    for (const video of items) {
      const status = video.videoStatus?.status || video.videoStatus;
      const url = video.videoUrl;

      if (url && status === 'completed') {
        totalDone++;
        if (alreadyPosted.has(video.id)) continue;

        // Write to Lark queue
        const scheduleDate = new Date(Date.now() + nextPostOffset);
        nextPostOffset += 4 * 60 * 60 * 1000; // next video 4h later

        const record = await larkCreateRecord({
          'Post Text': `Comment CULT CONTENT below and I'll send you the link.`,
          'Media URL': url,
          'Platform': PLATFORMS,
          'Scheduled Date': scheduleDate.toISOString().split('T')[0],
          'Status': 'Ready',
          'Notes': `Arcads | Script: ${script.name} | Video: ${video.id}`,
        });

        if (record.code === 0) {
          console.log(`  ✅ Queued: ${script.name} | ${video.id.slice(0,8)} → ${scheduleDate.toLocaleDateString()}`);
          alreadyPosted.add(video.id);
          newlyWritten++;
        } else {
          console.log(`  ⚠️  Lark write failed: ${JSON.stringify(record)}`);
        }
      } else {
        totalPending++;
      }
    }
  }

  console.log(`📊 ${totalDone} done, ${totalPending} pending, ${newlyWritten} newly queued to Lark`);
  return { totalDone, totalPending };
}

async function main() {
  if (WATCH_MODE) {
    console.log('👀 Watch mode — polling every 5 minutes until all 40 videos are done');
    while (true) {
      const { totalPending } = await poll();
      if (totalPending === 0) {
        console.log('\n🎉 All 40 videos done and queued to Lark!');
        break;
      }
      console.log(`⏳ ${totalPending} still generating. Next check in 5 min...`);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  } else {
    await poll();
  }
}

main().catch(console.error);
