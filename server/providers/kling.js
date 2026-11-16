// Kling AI — API: https://api.klingai.com/v1
// Auth: JWT (HS256) yang ditandatangani dengan SecretKey, header kid = AccessKey.
// Key yang ditempel user formatnya:  ACCESS_KEY:SECRET_KEY  (dipisah titik dua).
// generate(): POST videos/text2video -> polling task -> video url.
const crypto = require('crypto');
const { fetchJSON, poll } = require('./http');
const BASE = 'https://api.klingai.com/v1';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeJwt(accessKey, secretKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: accessKey }));
  const payload = b64url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const sig = crypto.createHmac('sha256', secretKey).update(header + '.' + payload).digest();
  return header + '.' + payload + '.' + b64url(sig);
}

function parseKey(apiKey) {
  const idx = (apiKey || '').indexOf(':');
  if (idx <= 0) throw new Error('Kling: format key harus ACCESS_KEY:SECRET_KEY (dipisah titik dua).');
  return { accessKey: apiKey.slice(0, idx).trim(), secretKey: apiKey.slice(idx + 1).trim() };
}

async function generate(job, apiKey) {
  const { accessKey, secretKey } = parseKey(apiKey);
  const token = makeJwt(accessKey, secretKey);
  const { status, ok, data } = await fetchJSON(BASE + '/videos/text2video', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_name: 'kling-v1',
      prompt: job.prompt,
      aspect_ratio: '9:16',
      duration: String(Math.min(Math.max(job.duration || 10, 5), 10))
    })
  }, 30000);
  if (status === 401 || status === 403) throw new Error('Kling: AccessKey/SecretKey ditolak (401/403).');
  if (!ok || !data || !data.data || !data.data.task_id) throw new Error('Kling: gagal membuat task (HTTP ' + status + ').');
  const taskId = data.data.task_id;
  const result = await poll(async () => {
    const r = await fetchJSON(BASE + '/videos/text2video/' + taskId, {
      headers: { Authorization: 'Bearer ' + makeJwt(accessKey, secretKey) }
    }, 30000);
    if (r.status === 401 || r.status === 403) throw new Error('Kling: kredensial ditolak saat polling.');
    const d = (r.data && r.data.data) || {};
    if (d.task_status === 'succeed') {
      const video = d.task_result && d.task_result.videos && d.task_result.videos[0];
      if (!video || !video.url) throw new Error('Kling: selesai tanpa URL video.');
      return { done: true, result: { videoUrl: video.url, durationSec: job.duration } };
    }
    if (d.task_status === 'failed') throw new Error('Kling: task gagal' + (d.task_status_msg ? ' — ' + d.task_status_msg : ''));
    return { done: false };
  }, { intervalMs: 10000, label: 'Kling task ' + taskId });
  return { ...result, provider: 'kling' };
}

async function testConnection(apiKey) {
  let accessKey, secretKey;
  try { ({ accessKey, secretKey } = parseKey(apiKey)); } catch (e) {
    return { ok: false, message: e.message };
  }
  const { status } = await fetchJSON(BASE + '/videos/text2video?pageNum=1&pageSize=1', {
    headers: { Authorization: 'Bearer ' + makeJwt(accessKey, secretKey) }
  }, 20000);
  if (status === 401 || status === 403) return { ok: false, message: 'AccessKey/SecretKey ditolak (401/403).' };
  if (status === 200) return { ok: true, message: 'Koneksi OK — kredensial diterima.' };
  return { ok: false, message: 'Respons HTTP ' + status + '.' };
}

module.exports = {
  id: 'kling',
  name: 'Kling AI',
  desc: 'Kling v1 — gerakan natural, auth JWT AccessKey + SecretKey',
  keyLabel: 'Kling AccessKey:SecretKey',
  keyHint: 'Tempel "ACCESS_KEY:SECRET_KEY" dari platform Kling (dipisah titik dua).',
  generate,
  testConnection
};
