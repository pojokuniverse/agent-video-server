// Custom / OpenAI-compatible endpoint.
// Dipakai untuk proxy atau layanan video lain yang mengikuti pola OpenAI:
//   POST {endpoint}/video/generations
//   Header: Authorization: Bearer <key>
//   Body:   { model, prompt, duration }
//   Respons yang diharapkan (salah satu):
//     { data: [{ url: "<video-url>" }] }  atau  { video_url: "<video-url>" }
//        atau  { url: "<video-url>" }
// Endpoint + model disimpan per user di Settings (bukan rahasia),
// key-nya disimpan terenkripsi seperti provider lain.
// Bila endpoint/model tidak diisi user, pakai env CUSTOM_VIDEO_BASE_URL / CUSTOM_VIDEO_MODEL.
const { fetchJSON, authError, poll } = require('./http');

function resolveConfig(opts) {
  const endpoint = (opts && opts.endpoint) || process.env.CUSTOM_VIDEO_BASE_URL || '';
  const model = (opts && opts.model) || process.env.CUSTOM_VIDEO_MODEL || 'video-1';
  if (!endpoint) throw new Error('Custom: endpoint belum diisi (Settings → Custom → Endpoint URL).');
  return { endpoint: endpoint.replace(/\/$/, ''), model };
}

async function generate(job, apiKey, opts) {
  const { endpoint, model } = resolveConfig(opts);
  const { status, ok, data } = await fetchJSON(endpoint + '/video/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: job.prompt, duration: job.duration || 10 })
  }, 30000);
  const ae = authError(status, 'Custom');
  if (ae) throw ae;
  if (!ok || !data) throw new Error('Custom: gagal membuat video (HTTP ' + status + ').');
  // Respons langsung berisi URL...
  const directUrl = (data.data && data.data[0] && data.data[0].url) || data.video_url || data.url;
  if (directUrl) return { videoUrl: directUrl, durationSec: job.duration, provider: 'custom' };
  // ...atau berupa task yang harus di-poll.
  const taskId = data.id || data.task_id;
  if (!taskId) throw new Error('Custom: respons tidak berisi URL video maupun task id.');
  const result = await poll(async () => {
    const r = await fetchJSON(endpoint + '/video/generations/' + taskId, {
      headers: { Authorization: 'Bearer ' + apiKey }
    }, 30000);
    const d = r.data || {};
    const url = (d.data && d.data[0] && d.data[0].url) || d.video_url || d.url;
    if (d.status === 'completed' || d.status === 'succeeded' || url) {
      if (!url) throw new Error('Custom: task selesai tanpa URL video.');
      return { done: true, result: { videoUrl: url, durationSec: job.duration } };
    }
    if (d.status === 'failed') throw new Error('Custom: task gagal.');
    return { done: false };
  }, { label: 'Custom task ' + taskId });
  return { ...result, provider: 'custom' };
}

async function testConnection(apiKey, opts) {
  let endpoint;
  try { ({ endpoint } = resolveConfig(opts)); } catch (e) {
    return { ok: false, message: e.message };
  }
  const { status } = await fetchJSON(endpoint + '/models', {
    headers: { Authorization: 'Bearer ' + apiKey }
  }, 20000);
  if (status === 401 || status === 403) return { ok: false, message: 'API key ditolak (401/403).' };
  if (status === 200 || status === 404) return { ok: true, message: 'Koneksi OK — endpoint merespons.' };
  return { ok: false, message: 'Respons HTTP ' + status + '.' };
}

module.exports = {
  id: 'custom',
  name: 'Custom (OpenAI-compatible)',
  desc: 'Endpoint video sendiri / proxy OpenAI-compatible — isi URL + model di Settings',
  keyLabel: 'API Key (Custom)',
  keyHint: 'Tempel API key endpoint custom kamu. Isi juga Endpoint URL + Model di bawah.',
  needsEndpoint: true,
  generate,
  testConnection
};
