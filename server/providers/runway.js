// Runway (Gen-4 Turbo) — API: https://api.dev.runwayml.com/v1
// Key: API key dari https://dev.runwayml.com/ (header Authorization: Bearer).
// generate(): POST text_to_video -> polling task -> output[0] (URL video).
const { fetchJSON, authError, poll } = require('./http');
const BASE = 'https://api.dev.runwayml.com/v1';

async function generate(job, apiKey) {
  const ratio = '720:1280'; // vertikal 9:16 untuk sosmed
  const { status, ok, data } = await fetchJSON(BASE + '/text_to_video', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'X-Runway-Version': '2024-11-06' },
    body: JSON.stringify({
      model: 'gen4_turbo',
      promptText: job.prompt,
      duration: Math.min(Math.max(job.duration || 10, 5), 16),
      ratio
    })
  }, 30000);
  const ae = authError(status, 'Runway');
  if (ae) throw ae;
  if (!ok || !data || !data.id) throw new Error('Runway: gagal membuat task (HTTP ' + status + ').');
  const result = await poll(async () => {
    const r = await fetchJSON(BASE + '/tasks/' + data.id, {
      headers: { Authorization: 'Bearer ' + apiKey, 'X-Runway-Version': '2024-11-06' }
    }, 30000);
    if (r.status === 401 || r.status === 403) throw new Error('Runway: API key ditolak saat polling.');
    const task = r.data || {};
    if (task.status === 'SUCCEEDED') return { done: true, result: { videoUrl: task.output && task.output[0], durationSec: job.duration } };
    if (task.status === 'FAILED') throw new Error('Runway: task gagal' + (task.failure ? ' — ' + task.failure : ''));
    if (task.status === 'CANCELLED') throw new Error('Runway: task dibatalkan.');
    return { done: false };
  }, { label: 'Runway task ' + data.id });
  if (!result.videoUrl) throw new Error('Runway: task selesai tanpa URL video.');
  return { ...result, provider: 'runway' };
}

async function testConnection(apiKey) {
  // Cek auth murah: POST dengan prompt kosong -> 400/422 = key lolos auth,
  // 401/403 = key tidak valid. Tidak membuat video.
  const { status } = await fetchJSON(BASE + '/text_to_video', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'X-Runway-Version': '2024-11-06' },
    body: JSON.stringify({ model: 'gen4_turbo', promptText: '', duration: 5, ratio: '720:1280' })
  }, 20000);
  if (status === 401 || status === 403) return { ok: false, message: 'API key ditolak (401/403).' };
  if (status === 400 || status === 422) return { ok: true, message: 'Koneksi OK — key diterima (validasi prompt gagal seperti yang diharapkan).' };
  return { ok: status < 500, message: 'Respons HTTP ' + status + ' (tidak bisa dipastikan, tapi bukan 401).' };
}

module.exports = {
  id: 'runway',
  name: 'Runway',
  desc: 'Gen-4 Turbo — kualitas film, API resmi dev.runwayml.com',
  keyLabel: 'Runway API Key',
  keyHint: 'Tempel API key dari dev.runwayml.com (diawali "key_...").',
  generate,
  testConnection
};
