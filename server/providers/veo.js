// Google Veo — via Gemini API (AI Studio / Vertex AI)
// Key: API key Google AI Studio (https://aistudio.google.com/app/apikey),
// dikirim sebagai query ?key=... dan header x-goog-api-key.
// generate(): predictLongRunning -> polling operation -> video URI (download pakai key).
const { fetchJSON, authError, poll } = require('./http');
const MODEL = 'veo-3.0-generate-001';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL;

async function generate(job, apiKey) {
  const { status, ok, data } = await fetchJSON(BASE + ':predictLongRunning', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt: job.prompt }],
      parameters: {
        aspectRatio: '9:16',
        durationSeconds: Math.min(Math.max(job.duration || 10, 5), 8),
        personGeneration: 'allow_adult'
      }
    })
  }, 30000);
  const ae = authError(status, 'Veo');
  if (ae) throw ae;
  if (!ok || !data || !data.name) throw new Error('Veo: gagal membuat operasi (HTTP ' + status + ').');
  const opName = data.name;
  const result = await poll(async () => {
    const r = await fetchJSON(
      'https://generativelanguage.googleapis.com/v1beta/' + opName,
      { headers: { 'x-goog-api-key': apiKey } }, 30000
    );
    if (r.status === 401 || r.status === 403) throw new Error('Veo: API key ditolak saat polling.');
    const op = r.data || {};
    if (op.done) {
      if (op.error) throw new Error('Veo: operasi gagal — ' + (op.error.message || 'tanpa pesan'));
      const sample = op.response && op.response.generatedSamples && op.response.generatedSamples[0];
      const uri = sample && sample.video && sample.video.uri;
      if (!uri) throw new Error('Veo: selesai tanpa URI video.');
      // URI video Google butuh key untuk diunduh; kembalikan dengan key di query.
      return { done: true, result: { videoUrl: uri + '&key=' + encodeURIComponent(apiKey), durationSec: job.duration } };
    }
    return { done: false };
  }, { intervalMs: 10000, timeoutMs: 240000, label: 'Veo operation ' + opName });
  return { ...result, provider: 'veo' };
}

async function testConnection(apiKey) {
  const { status } = await fetchJSON(
    'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey),
    {}, 20000
  );
  if (status === 401 || status === 403 || status === 400) return { ok: false, message: 'API key ditolak (HTTP ' + status + ').' };
  if (status === 200) return { ok: true, message: 'Koneksi OK — key diterima.' };
  return { ok: false, message: 'Respons HTTP ' + status + '.' };
}

module.exports = {
  id: 'veo',
  name: 'Google Veo',
  desc: 'Veo 3 via Gemini API — video + audio, API key Google AI Studio',
  keyLabel: 'Google AI Studio API Key',
  keyHint: 'Tempel API key dari aistudio.google.com (API key Gemini).',
  generate,
  testConnection
};
