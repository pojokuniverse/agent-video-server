// Mock provider: mengembalikan video contoh lokal supaya alur generate -> hasil jalan penuh.
// Tanda tangan sama seperti provider beneran: generate(job, apiKey, opts).
// Dipakai bila: mode demo, provider aktif = mock, atau fallback terakhir saat semua provider gagal.
const SAMPLE = {
  popular: '/sample-popular.mp4',
  funny: '/sample-funny.mp4',
  film: '/sample-film.mp4'
};

async function generate(job) {
  // Simulasi waktu render (provider beneran: polling status job di API mereka).
  await new Promise((r) => setTimeout(r, 1500));
  return {
    videoUrl: SAMPLE[job.mode] || SAMPLE.popular,
    durationSec: job.duration || 10,
    provider: 'mock'
  };
}

async function testConnection() {
  return { ok: true, message: 'Mock selalu OK (mode demo, tanpa API key).' };
}

module.exports = {
  id: 'mock',
  name: 'Demo (Mock)',
  desc: 'Video contoh lokal — tanpa API key, untuk mencoba alur',
  keyLabel: '—',
  keyHint: 'Provider demo tidak butuh API key.',
  generate,
  testConnection
};
