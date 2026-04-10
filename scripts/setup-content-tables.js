/**
 * Cult Content — Lark Table Setup
 *
 * Adds fields to the Content Pipeline table (already created),
 * creates the Hook Database table with fields, and seeds it
 * with starter hook frameworks.
 *
 * Run once: node scripts/setup-content-tables.js
 *
 * NOTE: Brand Voice field on Sellers (in Automate Everything v2)
 * must be added manually via the Lark UI — that base is read-only
 * for this Lark app. See PROJECT_SCOPE.md for instructions.
 */

require('dotenv').config();
const axios = require('axios');

const LARK_BASE = 'https://open.larksuite.com/open-apis';
const APP_TOKEN = process.env.LARK_BITABLE_APP_TOKEN; // Content Scheduler base

// Content Pipeline was already created — just need to add fields
const CONTENT_PIPELINE_TABLE_ID = 'tbl0nohouA9DLx2D';

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getToken() {
  const res = await axios.post(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: process.env.LARK_APP_ID,
    app_secret: process.env.LARK_APP_SECRET,
  });
  if (!res.data.tenant_access_token) throw new Error('Auth failed: ' + JSON.stringify(res.data));
  return res.data.tenant_access_token;
}

function hdr(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ─── Field / Table helpers ────────────────────────────────────────────────────
async function addField(token, tableId, name, type, property = null) {
  const body = { field_name: name, type };
  if (property) body.property = property;
  const res = await axios.post(
    `${LARK_BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`,
    body,
    { headers: hdr(token) }
  );
  if (res.data.code !== 0) throw new Error(`"${name}": ${res.data.msg} (${res.data.code})`);
  return res.data.data?.field?.field_id;
}

async function createTable(token, name) {
  const res = await axios.post(
    `${LARK_BASE}/bitable/v1/apps/${APP_TOKEN}/tables`,
    { table: { name } },
    { headers: hdr(token) }
  );
  if (res.data.code !== 0) throw new Error(`Table "${name}": ${res.data.msg} (${res.data.code})`);
  return res.data.data?.table_id;
}

async function createRecord(token, tableId, fields) {
  const res = await axios.post(
    `${LARK_BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`,
    { fields },
    { headers: hdr(token) }
  );
  if (res.data.code !== 0) throw new Error(`Record: ${res.data.msg} (${res.data.code})`);
  return res.data.data?.record?.record_id;
}

// ─── Field type constants ──────────────────────────────────────────────────────
const TEXT   = 1;
const NUMBER = 2;
const SELECT = 3;
const DATE   = 5;
const URL    = 15;

// ─── Seed hooks ───────────────────────────────────────────────────────────────
const STARTER_HOOKS = [
  // Curiosity
  { hook: 'You\'re losing money if you don\'t know this about [product]', framework: 'Curiosity', category: 'Knowledge gap', platform: 'All' },
  { hook: 'Nobody talks about this but [result/fact]', framework: 'Curiosity', category: 'Secret', platform: 'All' },
  { hook: 'I wish someone told me this sooner...', framework: 'Curiosity', category: 'Revelation', platform: 'All' },
  { hook: 'The reason your [problem] isn\'t getting better', framework: 'Curiosity', category: 'Root cause', platform: 'All' },
  { hook: 'What they don\'t tell you about [topic]', framework: 'Curiosity', category: 'Hidden truth', platform: 'All' },
  // Pain
  { hook: 'Tired of [specific pain point]? This fixed it for me', framework: 'Pain', category: 'Problem → Solution', platform: 'All' },
  { hook: 'I spent [time/money] trying to fix [problem] until I found this', framework: 'Pain', category: 'Struggle story', platform: 'All' },
  { hook: 'If you\'re dealing with [pain], stop what you\'re doing', framework: 'Pain', category: 'Interrupt', platform: 'All' },
  { hook: 'Why does [common problem] keep happening? Here\'s the real reason', framework: 'Pain', category: 'Problem diagnosis', platform: 'All' },
  // Result
  { hook: 'I tried [product] for 30 days — here\'s what happened', framework: 'Result', category: 'Before/After', platform: 'All' },
  { hook: 'This one thing changed [area of life] completely', framework: 'Result', category: 'Transformation', platform: 'All' },
  { hook: '[Number] [results] in [time frame] — here\'s exactly how', framework: 'Result', category: 'Specific outcome', platform: 'All' },
  { hook: 'The [product] that actually [delivers result]', framework: 'Result', category: 'Product proof', platform: 'TikTok' },
  { hook: 'From [before state] to [after state] in [timeframe]', framework: 'Result', category: 'Transformation arc', platform: 'All' },
  // Identity
  { hook: 'If you\'re a [specific person], you need to see this', framework: 'Identity', category: 'Audience call-out', platform: 'All' },
  { hook: 'This is for anyone who [relatable situation]', framework: 'Identity', category: 'Community signal', platform: 'All' },
  { hook: 'POV: You just discovered [product/solution]', framework: 'Identity', category: 'POV format', platform: 'TikTok' },
  { hook: 'Things people who [identity] know to be true', framework: 'Identity', category: 'Tribal knowledge', platform: 'All' },
  // Trend
  { hook: 'Everyone is talking about [trend] — here\'s why', framework: 'Trend', category: 'Trend commentary', platform: 'All' },
  { hook: 'TikTok made me buy it and I have no regrets', framework: 'Trend', category: 'Social proof trend', platform: 'TikTok' },
  { hook: 'The [product] everyone is ordering right now', framework: 'Trend', category: 'FOMO', platform: 'TikTok' },
  { hook: 'New on TikTok Shop and it\'s actually worth it', framework: 'Trend', category: 'Discovery', platform: 'TikTok' },
  // Contrast
  { hook: '[Common approach] vs [your approach] — the difference is insane', framework: 'Contrast', category: 'Comparison', platform: 'All' },
  { hook: 'Stop buying [expensive thing] — this does the same for [price]', framework: 'Contrast', category: 'Value contrast', platform: 'All' },
  { hook: 'What [expensive brand] doesn\'t want you to know', framework: 'Contrast', category: 'David vs Goliath', platform: 'All' },
  // Challenge
  { hook: 'I tested [claim] for [time] — honest results', framework: 'Challenge', category: 'Myth bust', platform: 'All' },
  { hook: 'Does [product] actually work? I tried it so you don\'t have to', framework: 'Challenge', category: 'Test/Review', platform: 'All' },
  { hook: 'Unpopular opinion: [contrarian take about your niche]', framework: 'Challenge', category: 'Contrarian', platform: 'All' },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Connecting to Lark...');
  const token = await getToken();
  console.log(`✓ Authenticated (app: ${APP_TOKEN})\n`);

  // ── 1. Add fields to Content Pipeline ────────────────────────────────────────
  console.log(`── Content Pipeline fields (${CONTENT_PIPELINE_TABLE_ID}) ──`);
  const pipelineFields = [
    ['Topic',          TEXT,   null],
    ['Angle',          TEXT,   null],
    ['Hook Type', SELECT, { options: [
      { name: 'Curiosity', color: 0 }, { name: 'Pain',      color: 2 },
      { name: 'Result',    color: 1 }, { name: 'Identity',  color: 3 },
      { name: 'Trend',     color: 4 }, { name: 'Contrast',  color: 5 },
      { name: 'Challenge', color: 6 },
    ]}],
    ['Status', SELECT, { options: [
      { name: 'Idea',      color: 0 }, { name: 'Scripting', color: 3 },
      { name: 'Scripted',  color: 1 }, { name: 'Filming',   color: 4 },
      { name: 'Filmed',    color: 2 }, { name: 'Posted',    color: 5 },
    ]}],
    ['Seller',         TEXT,   null],  // seller name (text for now)
    ['Hook',           TEXT,   null],
    ['Script',         TEXT,   null],
    ['CTA',            TEXT,   null],
    ['Caption',        TEXT,   null],
    ['Filming Notes',  TEXT,   null],
    ['Media URL',      URL,    null],
    ['Scheduled Date', DATE,   { date_formatter: 'yyyy/MM/dd HH:mm', auto_fill: false }],
    ['Notes',          TEXT,   null],
  ];

  for (const [name, type, prop] of pipelineFields) {
    try {
      const id = await addField(token, CONTENT_PIPELINE_TABLE_ID, name, type, prop);
      console.log(`  ✓ ${name}  (${id})`);
    } catch (e) {
      console.log(`  ⚠  ${e.message}`);
    }
  }

  // ── 2. Create Hook Database table ─────────────────────────────────────────────
  console.log('\n── Creating Hook Database table ──');
  let hookDbId;
  try {
    hookDbId = await createTable(token, 'Hook Database');
    console.log(`  ✓ Created: ${hookDbId}`);
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    process.exit(1);
  }

  const hookFields = [
    ['Framework', SELECT, { options: [
      { name: 'Curiosity', color: 0 }, { name: 'Pain',      color: 2 },
      { name: 'Result',    color: 1 }, { name: 'Identity',  color: 3 },
      { name: 'Trend',     color: 4 }, { name: 'Contrast',  color: 5 },
      { name: 'Challenge', color: 6 },
    ]}],
    ['Category',  TEXT,   null],
    ['Avg Views', NUMBER, { formatter: '0' }],
    ['Source', SELECT, { options: [
      { name: 'Cult Content', color: 1 },
      { name: 'Competitor',   color: 2 },
      { name: 'Template',     color: 0 },
    ]}],
    ['Platform', SELECT, { options: [
      { name: 'TikTok', color: 0 }, { name: 'Instagram', color: 1 },
      { name: 'YouTube', color: 2 }, { name: 'All', color: 3 },
    ]}],
    ['Notes', TEXT, null],
  ];

  for (const [name, type, prop] of hookFields) {
    try {
      const id = await addField(token, hookDbId, name, type, prop);
      console.log(`  ✓ ${name}  (${id})`);
    } catch (e) {
      console.log(`  ⚠  ${e.message}`);
    }
  }

  // ── 3. Seed Hook Database ─────────────────────────────────────────────────────
  console.log(`\n── Seeding Hook Database (${STARTER_HOOKS.length} hooks) ──`);
  let seeded = 0;
  for (const h of STARTER_HOOKS) {
    try {
      await createRecord(token, hookDbId, {
        'Hook Text': h.hook,
        'Framework': h.framework,
        'Category':  h.category,
        'Source':    'Template',
        'Platform':  h.platform,
      });
      seeded++;
      process.stdout.write('.');
    } catch (e) {
      process.stdout.write('x');
    }
  }
  console.log(`\n  ✓ ${seeded}/${STARTER_HOOKS.length} hooks seeded`);

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n✅ Setup complete!\n');
  console.log('Table IDs to add to CLAUDE.md and .env:');
  console.log(`  CONTENT_PIPELINE_TABLE_ID = ${CONTENT_PIPELINE_TABLE_ID}`);
  console.log(`  HOOK_DATABASE_TABLE_ID    = ${hookDbId}`);
  console.log('\nManual step still needed:');
  console.log('  → In Automate Everything v2 > Sellers table:');
  console.log('    Add a "Brand Voice" text field (long text)');
  console.log('    Fill it in for each seller with their tone, style, and example phrases');
}

main().catch(err => {
  console.error('\n✗ Fatal:', err.message);
  process.exit(1);
});
