// Agent Video — backend + bot Telegram
// Node.js + Express + grammy. Tanpa BOT_TOKEN, bot tidak jalan tapi API tetap jalan.
//
// API key video AI disimpan PER USER TELEGRAM, terenkripsi (vault.js, AES-256-GCM).
// Key utuh TIDAK PERNAH dikirim ke client dan TIDAK PERNAH di-log.
// Generate memakai key user -> fallback ke provider lain yang punya key
// (bila fallback aktif) -> key default server (env) -> mock demo.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Bot, InlineKeyboard } = require('grammy');
const providers = require('./providers');
const vault = require('./vault');
const textai = require('./textai');
const imageai = require('./imageai');

const PORT = parseInt(process.env.PORT || '3000', 10);
const WEBAPP_URL = process.env.WEBAPP_URL || ('http://localhost:' + PORT + '/');

const app = express();
app.use(express.json());

// ---------- Store in-memory (ganti DB bila sudah produksi) ----------
const jobs = new Map(); // id -> job
const history = [];     // job selesai, terbaru dulu
let seq = 1;

const MODES = ['popular', 'funny', 'film'];
const TRENDS = ['Kucing oren', 'AI robot joget', 'Mukbang pedas', 'Drama kantor', 'Dance challenge'];

// Env key default server per provider (fallback bila user belum isi key).
const ENV_KEYS = {
  runway: 'RUNWAY_API_KEY',
  kling: 'KLING_API_KEY',
  luma: 'LUMA_API_KEY',
  veo: 'GOOGLE_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  custom: 'CUSTOM_API_KEY'
};
function envKeyFor(providerId) {
  const name = ENV_KEYS[providerId];
  return name ? (process.env[name] || null) : null;
}

function titleFor(job) {
  const base = (job.prompt || '').slice(0, 40);
  if (job.mode === 'film' && job.filmKind === 'continue') return 'Lanjutan: ' + base;
  const label = { popular: 'Popular Video', funny: 'Funny Video', film: 'Film Video' }[job.mode];
  return label + ': ' + base;
}

// ---------- Identitas user ----------
// Di produksi, kirim initData Telegram dan validasi hash-nya (BOT_TOKEN).
// Bila initData tidak dikirim / BOT_TOKEN kosong, pakai userId apa adanya
// (mode demo) — dicatat di log sebagai 'unverified'.
function resolveUserId(req) {
  const body = req.body || {};
  const initData = body.initData || req.query.initData || '';
  if (initData && process.env.BOT_TOKEN) {
    const user = validateInitData(initData);
    if (!user) return { userId: null, error: 'INITDATA_INVALID' };
    return { userId: String(user.id), verified: true };
  }
  const userId = body.userId || req.query.userId || req.headers['x-telegram-user-id'] || 'demo';
  return { userId: String(userId), verified: false };
}

function validateInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheck = [...params.entries()].sort().map(([k, v]) => k + '=' + v).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
    if (calc !== hash) return null;
    const user = JSON.parse(params.get('user') || '{}');
    if (!user.id) return null;
    return user;
  } catch (e) {
    return null;
  }
}

// ---------- WebApp statis (suntik API base agar WebApp pakai backend ini) ----------
const WEBAPP_DIR = path.join(__dirname, '..', 'webapp');
app.get('/', (req, res) => {
  const html = fs.readFileSync(path.join(WEBAPP_DIR, 'index.html'), 'utf8');
  const injected = html.replace(
    '</head>',
    '<script>window.AGENT_VIDEO_API = location.origin;</script></head>'
  );
  res.type('html').send(injected);
});
app.use(express.static(WEBAPP_DIR));

// ---------- API ----------
app.get('/health', (req, res) => res.json({ ok: true, providers: providers.list().map((p) => p.id) }));

app.get('/api/trends', (req, res) => res.json({ trends: TRENDS }));

// ----- Settings: provider + API key user -----
app.get('/api/settings', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const base = vault.publicSettings(userId);
  const vaultData = vault.loadVault();
  const user = vault.getUser(vaultData, userId);
  const list = providers.list().map((meta) => ({
    ...meta,
    ...vault.publicProvider(user, meta.id),
    envDefault: !!envKeyFor(meta.id)
  }));
  res.json({
    ...base,
    providers: list,
    // Text AI — pilihan per user: Xingchi (env server) / APINEX (key user)
    // / template. Key TIDAK PERNAH dikirim (hanya last4 + status).
    textAI: {
      provider: user.textProvider || 'xingchi',
      xingchiConfigured: textai.configured(),
      xingchiModels: ['gpt-6-astra', 'gpt-6.1-sol'],
      apinex: vault.publicApinex(user),
      apinexTextModels: textai.APINEX_TEXT_MODELS,
      note: 'Hanya untuk teks/naskah. Render video tetap butuh key provider video.'
    },
    // Image AI (thumbnail/poster) — APINEX, key yang sama dengan Text AI.
    imageAI: {
      provider: 'apinex',
      apinex: vault.publicApinex(user),
      models: imageai.IMAGE_MODELS,
      note: 'Opsional: tiap video bisa dibuatkan thumbnail/poster. APINEX BUKAN provider video.'
    }
  });
});

app.post('/api/settings/key', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { provider, apiKey, endpoint, model } = req.body || {};
  if (!providers.isKnown(provider)) return res.status(400).json({ ok: false, error: 'PROVIDER_INVALID' });
  if (!apiKey || !String(apiKey).trim()) return res.status(400).json({ ok: false, error: 'KEY_REQUIRED' });
  if (provider === 'mock') return res.status(400).json({ ok: false, error: 'MOCK_NEEDS_NO_KEY' });
  const saved = vault.saveKey(userId, provider, String(apiKey).trim(), { endpoint, model });
  res.json({ ok: true, provider: saved });
});

app.delete('/api/settings/key', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { provider } = req.body || {};
  if (!providers.isKnown(provider)) return res.status(400).json({ ok: false, error: 'PROVIDER_INVALID' });
  vault.deleteKey(userId, provider);
  res.json({ ok: true });
});

app.post('/api/settings/active', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { provider } = req.body || {};
  if (!providers.isKnown(provider)) return res.status(400).json({ ok: false, error: 'PROVIDER_INVALID' });
  vault.setActive(userId, provider);
  res.json({ ok: true, activeProvider: provider });
});

app.post('/api/settings/fallback', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  vault.setFallback(userId, !!(req.body || {}).enabled);
  res.json({ ok: true, fallbackEnabled: !!(req.body || {}).enabled });
});

app.post('/api/settings/test', async (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { provider: providerId } = req.body || {};
  if (!providers.isKnown(providerId)) return res.status(400).json({ ok: false, error: 'PROVIDER_INVALID' });
  const mod = providers.load(providerId);
  const stored = vault.getKey(userId, providerId);
  const apiKey = stored ? stored.apiKey : envKeyFor(providerId);
  const opts = stored ? { endpoint: stored.endpoint, model: stored.model } : {};
  if (!apiKey) return res.status(400).json({ ok: false, error: 'KEY_MISSING', message: 'Belum ada key untuk provider ini (isi dulu di Settings).' });
  try {
    const result = await mod.testConnection(apiKey, opts);
    vault.setStatus(userId, providerId, result.ok ? 'ok' : 'failed');
    res.json({ ok: result.ok, message: result.message || '' });
  } catch (e) {
    vault.setStatus(userId, providerId, 'failed');
    res.json({ ok: false, message: 'Test gagal: ' + (e.message || 'error tidak diketahui') });
  }
});

// ----- Settings: Text AI (Xingchi / APINEX / template) -----
app.post('/api/settings/text', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { provider } = req.body || {};
  if (!['xingchi', 'apinex', 'template'].includes(provider)) {
    return res.status(400).json({ ok: false, error: 'TEXT_PROVIDER_INVALID' });
  }
  vault.setTextProvider(userId, provider);
  res.json({ ok: true, textProvider: provider });
});

app.post('/api/settings/text/key', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { apiKey, textModel, imageModel } = req.body || {};
  if (!apiKey || !String(apiKey).trim()) return res.status(400).json({ ok: false, error: 'KEY_REQUIRED' });
  if (!String(apiKey).trim().startsWith('sk-apx-')) {
    return res.status(400).json({ ok: false, error: 'KEY_FORMAT', message: 'Key APINEX diawali "sk-apx-...".' });
  }
  const saved = vault.saveApinexKey(userId, String(apiKey).trim(), { textModel, imageModel });
  res.json({ ok: true, apinex: saved });
});

app.delete('/api/settings/text/key', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  vault.deleteApinexKey(userId);
  res.json({ ok: true });
});

app.post('/api/settings/text/test', async (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { provider } = req.body || {};
  if (provider === 'xingchi') {
    const result = await textai.testXingchi();
    return res.json({ ok: result.ok, message: result.message });
  }
  if (provider === 'apinex') {
    const stored = vault.getApinexKey(userId);
    const apiKey = stored ? stored.apiKey : process.env.APINEX_API_KEY;
    if (!apiKey) return res.status(400).json({ ok: false, error: 'KEY_MISSING', message: 'Belum ada key APINEX (isi dulu di Settings).' });
    const result = await textai.testApinex(apiKey, stored ? stored.textModel : undefined);
    if (stored) vault.setApinexStatus(userId, result.ok ? 'ok' : 'failed');
    return res.json({ ok: result.ok, message: result.message });
  }
  return res.status(400).json({ ok: false, error: 'TEXT_PROVIDER_INVALID' });
});

app.post('/api/settings/image/model', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { imageModel, textModel } = req.body || {};
  vault.setApinexModels(userId, { imageModel, textModel });
  res.json({ ok: true });
});

// ----- Text AI (Xingchi / APINEX / template — teks/naskah saja, BUKAN render video) -----
// POST /api/assist { mode, prompt, style, filmKind, parentFilmId, userId? }
// -> { ok, text, source: 'xingchi' | 'apinex' | 'template', model? }
// Bila penyedia teks tidak tersedia/gagal: template lokal + source 'template'.
app.post('/api/assist', async (req, res) => {
  const { userId } = resolveUserId(req);
  const { mode, prompt, style, filmKind, parentFilmId } = req.body || {};
  if (!MODES.includes(mode)) return res.status(400).json({ ok: false, error: 'MODE_INVALID' });
  let parentTitle = null;
  let parentPrompt = null;
  if (mode === 'film' && filmKind === 'continue' && parentFilmId) {
    const parent = history.find((j) => j.id === parentFilmId)
      || [...jobs.values()].find((j) => j.id === parentFilmId);
    if (parent) { parentTitle = parent.title; parentPrompt = parent.prompt; }
  }
  // Resolusi penyedia teks per user.
  const vaultData = vault.loadVault();
  const user = vault.getUser(vaultData, userId);
  const textProvider = user.textProvider || 'xingchi';
  let config = { provider: 'template' };
  if (textProvider === 'xingchi' && textai.configured()) {
    config = { provider: 'xingchi' };
  } else if (textProvider === 'apinex') {
    const stored = vault.getApinexKey(userId);
    const apiKey = stored ? stored.apiKey : process.env.APINEX_API_KEY;
    if (apiKey) config = { provider: 'apinex', apiKey, model: stored ? stored.textModel : undefined };
  }
  try {
    const out = await textai.assist({ mode, prompt, style, filmKind, parentTitle, parentPrompt }, config);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'ASSIST_FAILED', message: e.message });
  }
});

// ----- Generate -----
app.post('/api/generate', (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { mode, prompt, duration, style, filmKind, parentFilmId, user } = req.body || {};
  if (!MODES.includes(mode)) return res.status(400).json({ ok: false, error: 'MODE_INVALID' });
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ ok: false, error: 'PROMPT_REQUIRED' });
  if (mode === 'film' && filmKind === 'continue' && !parentFilmId) {
    return res.status(400).json({ ok: false, error: 'PARENT_FILM_REQUIRED' });
  }
  const job = {
    id: 'job-' + Date.now() + '-' + (seq++),
    mode, prompt: String(prompt).trim(),
    duration: [5, 10, 15].includes(duration) ? duration : 10,
    style: style || 'realistis',
    filmKind: filmKind || (mode === 'film' ? 'new' : undefined),
    parentFilmId: parentFilmId || null,
    user: user || null,
    userId,
    status: 'queued', progress: 5, note: 'AI sedang menyiapkan adegan...',
    createdAt: new Date().toISOString()
  };
  job.title = titleFor(job);
  jobs.set(job.id, job);
  runJob(job);
  res.status(202).json(job);
});

// Urutan coba provider untuk satu job:
//  1. provider aktif + key user
//  2. (bila fallback aktif) provider lain yang punya key user, sesuai urutan Settings
//  3. provider aktif + key default server (env)
//  4. provider lain + key default server (env) — bila fallback aktif
//  5. mock demo (selalu terakhir, supaya alur tidak pernah buntu total)
function buildChain(userId) {
  const base = vault.publicSettings(userId);
  const vaultData = vault.loadVault();
  const user = vault.getUser(vaultData, userId);
  const active = base.activeProvider || 'mock';
  const fallback = base.fallbackEnabled !== false;
  const chain = [];
  const seen = new Set();
  const push = (providerId, apiKey, opts, source) => {
    if (seen.has(providerId) || !providers.isKnown(providerId)) return;
    seen.add(providerId);
    chain.push({ providerId, apiKey, opts: opts || {}, source });
  };
  const userKey = (pid) => {
    const k = vault.getKey(userId, pid);
    return k ? { apiKey: k.apiKey, opts: { endpoint: k.endpoint, model: k.model } } : null;
  };
  const activeUser = userKey(active);
  if (activeUser) push(active, activeUser.apiKey, activeUser.opts, 'user');
  if (fallback) {
    for (const pid of providers.ORDER) {
      if (pid === active) continue;
      const k = userKey(pid);
      if (k) push(pid, k.apiKey, k.opts, 'user');
    }
  }
  const activeEnv = envKeyFor(active);
  if (activeEnv) push(active, activeEnv, {}, 'server-default');
  if (fallback) {
    for (const pid of providers.ORDER) {
      const ek = envKeyFor(pid);
      if (ek) push(pid, ek, {}, 'server-default');
    }
  }
  push('mock', null, {}, 'mock');
  return chain;
}

async function runJob(job) {
  const chain = buildChain(job.userId);
  const attempts = [];
  const t1 = setTimeout(() => {
    if (job.status === 'queued') {
      job.status = 'generating'; job.progress = 30;
      job.note = 'AI sedang merender adegan video...';
    }
  }, 1200);
  const t2 = setTimeout(() => {
    if (job.status === 'generating') {
      job.progress = 60; job.note = 'Menambahkan gerakan & transisi...';
    }
  }, 3000);
  try {
    let done = null;
    for (const step of chain) {
      const mod = providers.load(step.providerId);
      try {
        job.note = 'Generate via ' + mod.name + (step.source === 'user' ? ' (key kamu)' : step.source === 'server-default' ? ' (key default server)' : ' (demo)') + '...';
        const result = await mod.generate(job, step.apiKey, step.opts);
        done = { ...result, usedProvider: step.providerId, keySource: step.source };
        break;
      } catch (e) {
        attempts.push(step.providerId + ': ' + (e.message || 'gagal'));
        console.warn('[job ' + job.id + '] provider ' + step.providerId + ' gagal:', e.message);
      }
    }
    clearTimeout(t1); clearTimeout(t2);
    if (!done) throw new Error('Semua provider gagal. ' + attempts.join(' | '));
    job.videoUrl = done.videoUrl;
    job.usedProvider = done.usedProvider;
    job.keySource = done.keySource;
    job.durationSec = done.durationSec || job.duration || 10;
    job.status = 'done';
    job.progress = 100;
    job.note = 'Video kamu sudah jadi!';
    job.finishedAt = new Date().toISOString();
    history.unshift(job);
    // Salin video ke cache lokal di latar (jangan blokir respons 'done'):
    // tombol Download selalu dilayani dari salinan lokal, supaya tetap jalan
    // walau URL provider sudah kedaluwarsa. Statusnya terlihat di /api/videos/:id.
    ensureLocalCopy(job).catch((e) => console.warn('[download] cache gagal untuk ' + job.id + ':', e.message));
  } catch (e) {
    clearTimeout(t1); clearTimeout(t2);
    job.status = 'failed';
    job.note = 'Gagal generate: ' + (e.message || 'error tidak diketahui');
    console.error('[job failed]', job.id, e);
  }
}

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });
  res.json(job);
});

app.get('/api/history', (req, res) => res.json({ jobs: history.slice(0, 50) }));

// ----- Thumbnail/poster (Image AI APINEX, opsional) -----
// POST /api/thumbnail { jobId, userId? } -> { ok, thumbnailUrl, model, price }
// Memakai SATU key APINEX yang sama dengan Text AI (atau env APINEX_API_KEY).
// APINEX BUKAN provider video — hanya model gambarnya yang dipakai di sini.
const THUMB_DIR = path.join(__dirname, 'data', 'thumbs');
app.post('/api/thumbnail', async (req, res) => {
  const { userId, error } = resolveUserId(req);
  if (error) return res.status(401).json({ ok: false, error });
  const { jobId } = req.body || {};
  const job = jobs.get(jobId) || history.find((j) => j.id === jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });
  const stored = vault.getApinexKey(userId);
  const apiKey = stored ? stored.apiKey : process.env.APINEX_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      ok: false, error: 'KEY_MISSING',
      message: 'Belum ada key APINEX — tempel dulu di Settings (Text AI / Image AI). Key dibuat sendiri di apinex.bond/keys.'
    });
  }
  try {
    const out = await imageai.generateThumbnail({
      title: job.title, prompt: job.prompt,
      apiKey, model: stored ? stored.imageModel : undefined
    });
    let thumbnailUrl;
    if (out.imageUrl) {
      thumbnailUrl = out.imageUrl;
    } else {
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      const filePath = path.join(THUMB_DIR, job.id + '.png');
      fs.writeFileSync(filePath, Buffer.from(out.imageBase64, 'base64'));
      thumbnailUrl = '/api/thumbnails/' + job.id;
    }
    job.thumbnailUrl = thumbnailUrl;
    job.thumbnailModel = out.model;
    job.thumbnailPrice = out.price;
    res.json({ ok: true, thumbnailUrl, model: out.model, price: out.price });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'THUMBNAIL_FAILED', message: e.message });
  }
});

app.get('/api/thumbnails/:id', (req, res) => {
  const filePath = path.join(THUMB_DIR, req.params.id + '.png');
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'THUMBNAIL_NOT_FOUND' });
  res.type('png').sendFile(filePath);
});

// ---------- Download video ----------
// Prinsip: tombol Download SELALU dilayani dari salinan lokal server
// (server/data/videos/<jobId>.mp4), bukan dari URL provider langsung —
// supaya download tetap jalan walau URL provider sudah kedaluwarsa, dan
// supaya tidak kena CORS/hotlink dari WebView Telegram.
//   - Video remote (URL http/https dari provider): diunduh ke cache saat job
//     selesai (ensureLocalCopy, di latar) atau saat download pertama diminta.
//   - Video mock (file contoh lokal /sample-*.mp4): disalin dari webapp/.
//   - Batas ukuran salinan: 200 MB (file lebih besar ditolak + dicatat).
// Endpoint TIDAK PERNAH mengekspos path file internal atau key provider —
// yang keluar hanya nama file hasil sanitasi + isi file video.
const VIDEO_DIR = path.join(__dirname, 'data', 'videos');
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

function safeJobId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

function downloadFilename(job) {
  const slug = String(job.title || 'agent-video')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // hapus diakritik
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent-video';
  return slug + '-' + job.id + '.mp4';
}

function findJob(id) {
  return jobs.get(id) || history.find((j) => j.id === id) || null;
}

function localVideoPath(jobId) {
  return path.join(VIDEO_DIR, jobId + '.mp4');
}

// Unduh/salin video job ke cache lokal. Mengembalikan true bila salinan siap.
// Idempotent: bila file sudah ada + ukurannya > 0, langsung dianggap siap.
async function ensureLocalCopy(job) {
  if (!job || !job.videoUrl) return false;
  const filePath = localVideoPath(job.id);
  try {
    const st = fs.statSync(filePath);
    if (st.size > 0) {
      job.downloadReady = true;
      job.fileSize = st.size;
      return true;
    }
  } catch (e) { /* belum ada — lanjut unduh */ }
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const url = job.videoUrl;
  try {
    if (url.startsWith('/sample-')) {
      // Video contoh lokal (mock) — salin dari direktori webapp.
      const src = path.join(WEBAPP_DIR, url.replace(/^\//, ''));
      fs.copyFileSync(src, filePath);
    } else if (/^https?:\/\//i.test(url)) {
      // Video remote dari provider — unduh ke cache (stream, batas 200 MB).
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300000) });
      if (!res.ok) throw new Error('Provider mengembalikan HTTP ' + res.status + ' saat mengambil video.');
      const len = parseInt(res.headers.get('content-length') || '0', 10);
      if (len > MAX_VIDEO_BYTES) throw new Error('Video terlalu besar (' + Math.round(len / 1048576) + ' MB, batas 200 MB).');
      const out = fs.createWriteStream(filePath);
      let received = 0;
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > MAX_VIDEO_BYTES) {
          reader.cancel();
          out.destroy();
          try { fs.unlinkSync(filePath); } catch (e) {}
          throw new Error('Video terlalu besar (batas 200 MB).');
        }
        out.write(value);
      }
      await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
    } else {
      throw new Error('Format URL video tidak dikenal.');
    }
    const st = fs.statSync(filePath);
    job.downloadReady = true;
    job.fileSize = st.size;
    job.downloadError = null;
    return true;
  } catch (e) {
    job.downloadReady = false;
    job.downloadError = e.message || 'Gagal menyiapkan file video.';
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (err) {}
    return false;
  }
}

// GET /api/videos/:id — metadata video + status kesiapan download.
// -> { ok, id, title, mode, videoUrl, durationSec, fileSize, downloadReady,
//      downloadError, filename, downloadUrl }
app.get('/api/videos/:id', (req, res) => {
  const id = safeJobId(req.params.id);
  const job = id ? findJob(id) : null;
  if (!job) return res.status(404).json({ ok: false, error: 'VIDEO_NOT_FOUND' });
  res.json({
    ok: true,
    id: job.id,
    title: job.title,
    mode: job.mode,
    videoUrl: job.videoUrl || null,
    durationSec: job.durationSec || job.duration || null,
    fileSize: job.fileSize || null,
    downloadReady: !!job.downloadReady,
    downloadError: job.downloadError || null,
    filename: downloadFilename(job),
    downloadUrl: '/api/download/' + job.id
  });
});

// GET /api/download/:id — stream file video sebagai attachment.
// Dukung Range request (206 Partial Content) supaya file besar bisa di-resume.
// Bila salinan lokal belum siap, coba siapkan dulu (unduh dari provider);
// bila tetap gagal -> 502 JSON dengan pesan Bahasa Indonesia.
function sendVideoFile(req, res, filePath, filename) {
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', total);
    return res.status(200).end();
  }
  if (!range) {
    res.setHeader('Content-Length', total);
    res.status(200);
    return fs.createReadStream(filePath).pipe(res);
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) {
    res.setHeader('Content-Length', total);
    res.status(200);
    return fs.createReadStream(filePath).pipe(res);
  }
  let start = m[1] === '' ? 0 : parseInt(m[1], 10);
  let end = m[2] === '' ? total - 1 : parseInt(m[2], 10);
  if (isNaN(start) || isNaN(end) || start > end || start >= total) {
    res.setHeader('Content-Range', 'bytes */' + total);
    return res.status(416).end();
  }
  end = Math.min(end, total - 1);
  res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
  res.setHeader('Content-Length', end - start + 1);
  res.status(206);
  return fs.createReadStream(filePath, { start, end }).pipe(res);
}

app.get('/api/download/:id', async (req, res) => {
  const id = safeJobId(req.params.id);
  const job = id ? findJob(id) : null;
  if (!job) return res.status(404).json({ ok: false, error: 'VIDEO_NOT_FOUND', message: 'Video tidak ditemukan.' });
  if (!job.videoUrl) return res.status(404).json({ ok: false, error: 'VIDEO_NOT_READY', message: 'Video belum selesai dibuat.' });
  const filePath = localVideoPath(job.id);
  let ready = job.downloadReady && fs.existsSync(filePath);
  if (!ready) {
    // Salinan belum ada — coba siapkan sekarang (tunggu sampai selesai).
    ready = await ensureLocalCopy(job);
  }
  if (!ready || !fs.existsSync(filePath)) {
    return res.status(502).json({
      ok: false, error: 'DOWNLOAD_NOT_READY',
      message: 'File video belum bisa disiapkan: ' + (job.downloadError || 'coba lagi sebentar.')
    });
  }
  try {
    sendVideoFile(req, res, filePath, downloadFilename(job));
  } catch (e) {
    res.status(500).json({ ok: false, error: 'DOWNLOAD_FAILED', message: 'Gagal mengirim file video.' });
  }
});

// Upload sosmed — STUB: OAuth tiap platform belum dipasang (lihat README).
// Mengembalikan error rapi agar klien tahu akun belum terhubung.
app.post('/api/upload/:platform', (req, res) => {
  const platform = req.params.platform;
  if (!['facebook', 'youtube', 'x'].includes(platform)) {
    return res.status(400).json({ ok: false, error: 'PLATFORM_INVALID' });
  }
  return res.status(501).json({
    ok: false,
    error: 'PLATFORM_NOT_CONNECTED',
    platform,
    message: 'Akun ' + platform + ' belum terhubung. Hubungkan dulu lewat OAuth (lihat README).'
  });
});

// ---------- Bot Telegram ----------
if (process.env.BOT_TOKEN) {
  const bot = new Bot(process.env.BOT_TOKEN);
  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🎬 Selamat datang di *Agent Video*!\n\n' +
      'AI bikin video buat kamu — dari tren populer pekan ini, video lucu, sampai film bersambung.\n' +
      'Hasilnya bisa langsung di-upload ke Facebook, YouTube, dan X.\n\n' +
      'Tekan tombol di bawah untuk mulai:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().webApp('🎬 Buka Agent Video', WEBAPP_URL)
      }
    );
  });
  bot.command('help', (ctx) => ctx.reply('Buka Agent Video lewat tombol di /start, lalu pilih mode: Popular, Funny, atau Film.'));
  bot.start().then(() => console.log('[bot] berjalan'));
} else {
  console.log('[bot] BOT_TOKEN kosong — bot tidak dijalankan (API tetap jalan).');
}

app.listen(PORT, () => {
  console.log('[server] Agent Video jalan di http://localhost:' + PORT + '/');
  console.log('[server] provider terdaftar: ' + providers.list().map((p) => p.id).join(', '));
  console.log('[server] WebApp URL: ' + WEBAPP_URL);
});
