// MiniMax / Hailuo — API: https://api.minimax.chat/v1
// Key: API key dari https://platform.minimax.chat/ (header Authorization: Bearer).
// generate(): POST video_generation -> polling query -> retrieve file URL.
const { fetchJSON, authError, poll } = require('./http');
const BASE = 'https://api.minimax.chat/v1';

async function generate(job, apiKey) {
  const { status, ok, data } = await fetchJSON(BASE + '/video_generation', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'T2V-01', prompt: job.prompt })
  }, 30000);
  const ae = authError(status, 'MiniMax');
  if (ae) throw ae;
  if (!ok || !data || !data.task_id) throw new Error('MiniMax: gagal membuat task (HTTP ' + status + ').');
  const taskId = data.task_id;
  const result = await poll(async () => {
    const r = await fetchJSON(BASE + '/query/video_generation?task_id=' + taskId, {
      headers: { Authorization: 'Bearer ' + apiKey }
    }, 30000);
    if (r.status === 401 || r.status === 403) throw new Error('MiniMax: API key ditolak saat polling.');
    const d = r.data || {};
    if (d.status === 'Success') {
      const fileId = d.file_id;
      if (!fileId) throw new Error('MiniMax: selesai tanpa file_id.');
      const fr = await fetchJSON(BASE + '/files/retrieve?file_id=' + fileId, {
        headers: { Authorization: 'Bearer ' + apiKey }
      }, 30000);
      const url = fr.data && (fr.data.file && fr.data.file.download_url || fr.data.download_url);
      if (!url) throw new Error('MiniMax: tidak dapat mengambil URL unduhan.');
      return { done: true, result: { videoUrl: url, durationSec: job.duration } };
    }
    if (d.status === 'Fail') throw new Error('MiniMax: task gagal.');
    return { done: false };
  }, { intervalMs: 10000, label: 'MiniMax task ' + taskId });
  return { ...result, provider: 'minimax' };
}

async function testConnection(apiKey) {
  const { status } = await fetchJSON(BASE + '/query/video_generation?task_id=__test__', {
    headers: { Authorization: 'Bearer ' + apiKey }
  }, 20000);
  if (status === 401 || status === 403) return { ok: false, message: 'API key ditolak (401/403).' };
  if (status === 200 || status === 404) return { ok: true, message: 'Koneksi OK — key diterima.' };
  return { ok: false, message: 'Respons HTTP ' + status + '.' };
}

module.exports = {
  id: 'minimax',
  name: 'MiniMax / Hailuo',
  desc: 'Hailuo T2V-01 — video realistis, platform.minimax.chat',
  keyLabel: 'MiniMax API Key',
  keyHint: 'Tempel API key dari platform.minimax.chat.',
  generate,
  testConnection
};
