// Luma Dream Machine — API: https://api.lumalabs.ai/dream-machine/v1
// Key: API key dari https://lumalabs.ai/dream-machine/api (header Authorization: Bearer).
const { fetchJSON, authError, poll } = require('./http');
const BASE = 'https://api.lumalabs.ai/dream-machine/v1';

async function generate(job, apiKey) {
  const { status, ok, data } = await fetchJSON(BASE + '/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: job.prompt,
      aspect_ratio: '9:16',
      duration: (job.duration || 10) + 's'
    })
  }, 30000);
  const ae = authError(status, 'Luma');
  if (ae) throw ae;
  if (!ok || !data || !data.id) throw new Error('Luma: gagal membuat generation (HTTP ' + status + ').');
  const result = await poll(async () => {
    const r = await fetchJSON(BASE + '/generations/' + data.id, {
      headers: { Authorization: 'Bearer ' + apiKey }
    }, 30000);
    if (r.status === 401 || r.status === 403) throw new Error('Luma: API key ditolak saat polling.');
    const g = r.data || {};
    if (g.state === 'completed') {
      return { done: true, result: { videoUrl: g.assets && g.assets.video, durationSec: job.duration } };
    }
    if (g.state === 'failed') throw new Error('Luma: generation gagal' + (g.failure_reason ? ' — ' + g.failure_reason : ''));
    return { done: false };
  }, { label: 'Luma generation ' + data.id });
  if (!result.videoUrl) throw new Error('Luma: selesai tanpa URL video.');
  return { ...result, provider: 'luma' };
}

async function testConnection(apiKey) {
  const { status } = await fetchJSON(BASE + '/generations?limit=1', {
    headers: { Authorization: 'Bearer ' + apiKey }
  }, 20000);
  if (status === 401 || status === 403) return { ok: false, message: 'API key ditolak (401/403).' };
  if (status === 200) return { ok: true, message: 'Koneksi OK — key diterima.' };
  return { ok: false, message: 'Respons HTTP ' + status + '.' };
}

module.exports = {
  id: 'luma',
  name: 'Luma Dream Machine',
  desc: 'Dream Machine — gerakan kamera sinematik, API lumalabs.ai',
  keyLabel: 'Luma API Key',
  keyHint: 'Tempel API key dari lumalabs.ai (dashboard API Keys).',
  generate,
  testConnection
};
