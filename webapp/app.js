// Agent Video — Telegram Mini App (WebApp)
// Berjalan 2 mode:
//  1. Terhubung backend (window.AGENT_VIDEO_API diisi server) -> pakai REST API.
//  2. Mode demo/standalone (dibuka sebagai halaman biasa / Space) -> mock lokal,
//     progress disimulasikan, video contoh lokal diputar.
(function () {
  'use strict';

  var API_BASE = (window.AGENT_VIDEO_API || '').replace(/\/$/, '');
  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

  var TRENDS_FALLBACK = ['Kucing oren', 'AI robot joget', 'Mukbang pedas', 'Drama kantor', 'Dance challenge'];
  var SAMPLE_VIDEO = { popular: 'sample-popular.mp4', funny: 'sample-funny.mp4', film: 'sample-film.mp4' };
  var MODE_LABEL = { popular: 'Popular Video', funny: 'Funny Video', film: 'Film Video' };

  var state = { mode: null, filmKind: 'new', parentFilmId: null, currentJob: null, user: null };
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Telegram login ----------
  function initUser() {
    var user = null;
    try {
      if (tg) {
        tg.ready();
        tg.expand();
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) user = tg.initDataUnsafe.user;
      }
    } catch (e) { /* abaikan, pakai demo */ }
    if (!user) {
      user = { first_name: 'Tamu', username: 'demo', photo_url: '' };
      $('mode-badge').textContent = 'DEMO';
      $('mode-badge').classList.add('demo');
      $('user-sub').textContent = 'Mode Demo — buka lewat Telegram untuk login';
    } else {
      $('mode-badge').textContent = 'TELEGRAM';
      $('user-sub').textContent = user.username ? '@' + user.username : 'Login via Telegram ✓';
    }
    state.user = user;
    $('user-name').textContent = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Tamu';
    if (user.photo_url) {
      $('user-photo').src = user.photo_url;
      $('user-photo').style.display = 'block';
      $('user-photo-fallback').style.display = 'none';
    }
    try { if (tg) tg.setHeaderColor('bg_color'); } catch (e) {}
  }

  // ---------- Navigasi ----------
  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    $('view-' + name).classList.add('active');
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === name);
    });
    if (name === 'history') renderHistory();
    if (name === 'social') renderSocial();
    if (name === 'settings') loadSettings();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.dataset.view); });
  });

  // ---------- Toast ----------
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, 3200);
  }

  // ---------- Riwayat (localStorage + server) ----------
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem('av_history') || '[]'); } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem('av_history', JSON.stringify(list.slice(0, 50))); } catch (e) {}
  }
  function addHistory(item) {
    var list = loadHistory();
    list.unshift(item);
    saveHistory(list);
  }

  function renderHistory() {
    var list = loadHistory();
    var box = $('history-list');
    box.innerHTML = '';
    $('history-empty').style.display = list.length ? 'none' : 'block';
    list.forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = '<video src="' + item.videoUrl + '" muted preload="metadata"></video>' +
        '<div><div class="h-title"></div><div class="h-meta"></div></div>';
      div.querySelector('.h-title').textContent = item.title;
      div.querySelector('.h-meta').textContent =
        MODE_LABEL[item.mode] + ' • ' + new Date(item.createdAt).toLocaleDateString('id-ID') +
        (item.durationSec ? ' • ' + item.durationSec + ' dtk' : '') +
        (item.fileSize ? ' • ' + formatBytes(item.fileSize) : '');
      // Tombol download per item (klik tombol = download, klik item = buka hasil).
      var actions = document.createElement('div');
      actions.className = 'h-actions';
      var dl = document.createElement('a');
      dl.className = 'history-download';
      dl.href = downloadUrlFor(item);
      dl.setAttribute('download', downloadFilenameFor(item));
      dl.textContent = '⬇️ Download';
      dl.addEventListener('click', function (ev) { ev.stopPropagation(); });
      actions.appendChild(dl);
      div.appendChild(actions);
      div.addEventListener('click', function () { openResult(item); });
      box.appendChild(div);
    });
  }

  // ---------- Download video ----------
  // Alur: tombol Download mengarah ke /api/download/:id (server) atau ke file
  // contoh lokal (mode demo). Di WebView Telegram, atribut download kadang
  // diabaikan — tombol "Buka di Browser" jadi fallback (tg.openLink).
  function formatBytes(n) {
    if (!n || n <= 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function downloadFilenameFor(item) {
    var slug = String(item.title || 'agent-video').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent-video';
    return slug + '-' + item.id + '.mp4';
  }
  function downloadUrlFor(item) {
    if (apiAvailable()) return apiUrl('/api/download/' + encodeURIComponent(item.id));
    return item.videoUrl;
  }
  function absoluteUrl(url) {
    try { return new URL(url, location.href).href; } catch (e) { return url; }
  }
  function setupDownload(item) {
    var btn = $('btn-download');
    var meta = $('download-meta');
    var status = $('download-status');
    var ext = $('btn-open-external');
    var filename = downloadFilenameFor(item);
    btn.setAttribute('download', filename);
    btn.href = downloadUrlFor(item);
    btn.classList.remove('preparing', 'failed');
    btn.textContent = '⬇️ Download Video';
    ext.style.display = 'none';
    status.textContent = '';
    var metaParts = [];
    if (item.durationSec) metaParts.push('⏱️ Durasi ' + item.durationSec + ' dtk');
    if (item.fileSize) metaParts.push('📦 Ukuran ' + formatBytes(item.fileSize));
    meta.textContent = metaParts.join(' • ');
    // Fallback "buka di browser": selalu tampil di dalam Telegram, karena
    // WebView Telegram sering memblokir download langsung.
    if (tg) {
      ext.style.display = 'block';
      ext.onclick = function () {
        var url = absoluteUrl(downloadUrlFor(item));
        try { tg.openLink(url); } catch (e) { window.open(url, '_blank'); }
      };
    }
    if (!apiAvailable()) {
      // Mode demo / Space statis: yang diunduh file contoh lokal.
      if (!metaParts.length) meta.textContent = 'Video contoh (mode demo)';
      status.textContent = 'Mode demo — file yang diunduh adalah video contoh. Video provider asli butuh backend produksi.';
      return;
    }
    // Mode backend: cek kesiapan salinan di server; bila belum siap, polling
    // status sampai siap (server mengunduh salinan dari provider di latar).
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      fetch(apiUrl('/api/videos/' + encodeURIComponent(item.id)))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) { clearInterval(timer); return; }
          if (d.downloadReady) {
            clearInterval(timer);
            var parts = [];
            if (d.durationSec) parts.push('⏱️ Durasi ' + d.durationSec + ' dtk');
            if (d.fileSize) parts.push('📦 Ukuran ' + formatBytes(d.fileSize));
            meta.textContent = parts.join(' • ');
            status.textContent = '';
            btn.classList.remove('preparing');
            // Simpan ukuran ke riwayat lokal supaya tampil di tab Riwayat.
            var list = loadHistory();
            list.forEach(function (h) {
              if (h.id === item.id) { h.fileSize = d.fileSize; h.durationSec = d.durationSec; }
            });
            saveHistory(list);
          } else if (d.downloadError) {
            clearInterval(timer);
            status.textContent = '❌ File belum bisa disiapkan: ' + d.downloadError + ' Coba lagi sebentar.';
            btn.classList.add('failed');
          } else if (tries >= 24) {
            clearInterval(timer);
            status.textContent = '⏳ File masih disiapkan server — tekan Download lagi sebentar lagi.';
          } else {
            status.textContent = '⏳ Menyiapkan file video… (server sedang mengunduh salinannya)';
            btn.classList.add('preparing');
          }
        })
        .catch(function () { clearInterval(timer); });
    }, 2500);
  }

  // ---------- Sosmed (stub connect) ----------
  var SOCIALS = [
    { id: 'facebook', name: 'Facebook', emoji: '📘', desc: 'Upload ke Feed / Reels' },
    { id: 'youtube', name: 'YouTube', emoji: '▶️', desc: 'Upload ke Shorts / Video' },
    { id: 'x', name: 'X (Twitter)', emoji: '𝕏', desc: 'Upload ke timeline' }
  ];
  function connectedPlatforms() {
    try { return JSON.parse(localStorage.getItem('av_social') || '{}'); } catch (e) { return {}; }
  }
  function renderSocial() {
    var connected = connectedPlatforms();
    var box = $('social-list');
    box.innerHTML = '';
    SOCIALS.forEach(function (s) {
      var div = document.createElement('div');
      div.className = 'social-card';
      var isConn = !!connected[s.id];
      div.innerHTML = '<span class="s-emoji">' + s.emoji + '</span>' +
        '<div class="s-info"><div class="s-name">' + s.name + '</div>' +
        '<div class="s-status">' + (isConn ? '✅ Terhubung: ' + connected[s.id] : 'Belum terhubung — ' + s.desc) + '</div></div>';
      var btn = document.createElement('button');
      btn.className = 'connect-btn' + (isConn ? ' connected' : '');
      btn.textContent = isConn ? 'Terhubung' : 'Hubungkan';
      btn.addEventListener('click', function () {
        // STUB: OAuth beneran butuh App ID + redirect (lihat README).
        toast(s.name + ': OAuth belum dipasang — lihat README untuk langkahnya.');
      });
      div.appendChild(btn);
      box.appendChild(div);
    });
  }

  // ---------- Form generate ----------
  function openGenerate(mode) {
    state.mode = mode;
    state.filmKind = 'new';
    state.parentFilmId = null;
    $('gen-title').textContent = 'Buat ' + MODE_LABEL[mode];
    $('film-choice').style.display = mode === 'film' ? 'flex' : 'none';
    $('trend-box').style.display = mode === 'popular' ? 'block' : 'none';
    if (mode === 'popular') renderTrends();
    if (mode === 'film') renderFilmChoice();
    $('prompt').value = '';
    showView('generate');
  }
  document.querySelectorAll('.mode-card').forEach(function (c) {
    c.addEventListener('click', function () { openGenerate(c.dataset.mode); });
  });
  $('back-home').addEventListener('click', function () { showView('home'); });
  $('back-home-2').addEventListener('click', function () { showView('home'); });

  function renderTrends() {
    var box = $('trend-chips');
    box.innerHTML = '';
    var trends = TRENDS_FALLBACK;
    fetch(apiUrl('/api/trends')).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.trends && d.trends.length) { trends = d.trends; paint(); } })
      .catch(function () { /* pakai fallback */ });
    function paint() {
      box.innerHTML = '';
      trends.forEach(function (t) {
        var chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = t;
        chip.addEventListener('click', function () {
          chip.classList.toggle('selected');
          var p = $('prompt');
          p.value = p.value ? p.value + ', ' + t : t;
        });
        box.appendChild(chip);
      });
    }
    paint();
  }

  // Film: New Film vs Lanjutkan Cerita
  document.querySelectorAll('.choice-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      state.filmKind = b.dataset.filmKind;
      document.querySelectorAll('.choice-btn').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      renderFilmChoice();
    });
  });
  function renderFilmChoice() {
    var isContinue = state.filmKind === 'continue';
    $('film-list').style.display = isContinue ? 'block' : 'none';
    if (!isContinue) return;
    var films = loadHistory().filter(function (h) { return h.mode === 'film'; });
    var box = $('film-list-items');
    box.innerHTML = '';
    $('film-list-empty').style.display = films.length ? 'none' : 'block';
    films.forEach(function (f) {
      var btn = document.createElement('button');
      btn.className = 'film-item';
      btn.innerHTML = '<b></b><small></small>';
      btn.querySelector('b').textContent = f.title;
      btn.querySelector('small').textContent = new Date(f.createdAt).toLocaleDateString('id-ID') + ' • ' + (f.prompt || '');
      btn.addEventListener('click', function () {
        state.parentFilmId = f.id;
        document.querySelectorAll('.film-item').forEach(function (x) { x.classList.remove('selected'); });
        btn.classList.add('selected');
        $('prompt').value = 'Lanjutan dari film "' + f.title + '": ';
        $('prompt').focus();
      });
      box.appendChild(btn);
    });
  }

  // ---------- Generate ----------
  function apiUrl(path) { return API_BASE ? API_BASE + path : path; }
  function apiAvailable() { return !!API_BASE; }
  function userIdForApi() {
    return (state.user && state.user.id) ? String(state.user.id) : 'demo';
  }
  var PROVIDER_NAMES = { runway: 'Runway', kling: 'Kling AI', luma: 'Luma', veo: 'Google Veo', minimax: 'MiniMax', custom: 'Custom', mock: 'Demo (Mock)' };

  $('btn-generate').addEventListener('click', function () {
    var prompt = $('prompt').value.trim();
    if (state.mode === 'film' && state.filmKind === 'continue' && !state.parentFilmId) {
      toast('Pilih dulu film yang mau dilanjutkan, atau pilih New Film.');
      return;
    }
    if (!prompt) {
      toast('Isi dulu tema / prompt videonya.');
      return;
    }
    var payload = {
      mode: state.mode,
      prompt: prompt,
      duration: parseInt($('duration').value, 10),
      style: $('style').value,
      filmKind: state.mode === 'film' ? state.filmKind : undefined,
      parentFilmId: state.parentFilmId || undefined,
      user: state.user ? { id: state.user.id, username: state.user.username } : undefined,
      userId: userIdForApi(),
      initData: (tg && tg.initData) ? tg.initData : undefined
    };
    startJob(payload);
  });

  // ---------- Bantu Tulis Naskah AI (Xingchi, teks saja) ----------
  // Prompt hasil assist ini yang diteruskan ke provider video saat Generate.
  $('btn-assist').addEventListener('click', function () {
    var btn = $('btn-assist');
    btn.textContent = '✍️ Menulis naskah...';
    btn.disabled = true;
    var body = {
      mode: state.mode,
      prompt: $('prompt').value.trim(),
      style: $('style').value,
      filmKind: state.mode === 'film' ? state.filmKind : undefined,
      parentFilmId: state.parentFilmId || undefined,
      userId: userIdForApi()
    };
    var done = function (text, source, model) {
      $('prompt').value = text;
      $('assist-source').textContent = source === 'xingchi'
        ? '✍️ Naskah ditulis AI (Xingchi' + (model ? ', ' + model : '') + ') — makan kuota Xingchi kamu.'
        : source === 'apinex'
          ? '✍️ Naskah ditulis AI (APINEX' + (model ? ', ' + model : '') + ') — model FREE, makan kuota APINEX kamu.'
          : '📝 Naskah template, bukan AI — Text AI belum dikonfigurasi.';
      btn.textContent = '✨ Bantu Tulis Naskah AI';
      btn.disabled = false;
    };
    if (!apiAvailable()) {
      // Mode demo: template lokal, dilabeli jujur.
      setTimeout(function () {
        done(demoTemplate(body), 'template');
      }, 600);
      return;
    }
    fetch(apiUrl('/api/assist'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) done(d.text, d.source, d.model);
        else done(demoTemplate(body), 'template');
      })
      .catch(function () { done(demoTemplate(body), 'template'); });
  });

  function demoTemplate(body) {
    var topic = body.prompt || 'ide acak';
    if (body.mode === 'popular') {
      return 'Video vertikal 9:16: ' + topic + ' dengan sentuhan tren pekan ini. Satu adegan utama yang kuat, gerakan kamera pelan, cahaya hangat, akhir yang mengejutkan.';
    }
    if (body.mode === 'funny') {
      return 'NASKAH LUCU — Premis: ' + topic + '\nAdegan 1: tokoh utama mencoba hal mustahil dan gagal total.\nAdegan 2: teman tokoh malah sukses tanpa sengaja.\nAdegan 3: punchline — tokoh pura-pura memang sengaja dari awal.';
    }
    if (body.mode === 'film' && body.filmKind === 'continue') {
      return 'LANJUTAN CERITA — tokoh melanjutkan dari episode lalu: ' + topic + '.\nAdegan 1: kelanjutan dari akhir episode lalu.\nAdegan 2: konflik baru muncul.\nAdegan 3: klimaks kecil + gantungan episode berikut.';
    }
    return 'STORYBOARD FILM BARU — "' + topic + '":\nAdegan 1 (pembuka): perkenalkan tokoh + dunia film ini.\nAdegan 2 (konflik): masalah muncul.\nAdegan 3 (penutup): penyelesaian + gantungan cerita.';
  }

  function startJob(payload) {
    showView('job');
    $('job-result').style.display = 'none';
    setJobProgress(0, '⏳ Antre...', 'AI sedang menyiapkan adegan...');
    if (apiAvailable()) {
      fetch(apiUrl('/api/generate'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); })
        .then(function (job) { pollJob(job.id); })
        .catch(function () { runMockJob(payload); });
    } else {
      runMockJob(payload);
    }
  }

  function pollJob(jobId) {
    var timer = setInterval(function () {
      fetch(apiUrl('/api/jobs/' + jobId)).then(function (r) { return r.json(); })
        .then(function (job) {
          setJobProgress(job.progress || 0, statusLabel(job.status), job.note || '');
          if (job.status === 'done') { clearInterval(timer); finishJob(job); }
          if (job.status === 'failed') { clearInterval(timer); setJobProgress(0, '❌ Gagal', job.note || 'Coba lagi.'); }
        })
        .catch(function () { clearInterval(timer); });
    }, 1200);
  }

  // Mock lokal (mode demo / tanpa backend): progress simulasi + video contoh
  function runMockJob(payload) {
    var steps = [
      [10, '⏳ Antre...', 'AI sedang menyiapkan adegan...'],
      [35, '🎬 Generating...', 'AI sedang merender adegan video...'],
      [65, '🎬 Generating...', 'Menambahkan gerakan & transisi...'],
      [90, '✨ Finishing...', 'Menyelesaikan video & menyiapkan file...'],
      [100, '✅ Selesai', 'Video kamu sudah jadi!']
    ];
    var i = 0;
    var job = {
      id: 'mock-' + Date.now(),
      mode: payload.mode,
      title: makeTitle(payload),
      prompt: payload.prompt,
      videoUrl: SAMPLE_VIDEO[payload.mode] || SAMPLE_VIDEO.popular,
      createdAt: new Date().toISOString(),
      parentFilmId: payload.parentFilmId || null
    };
    state.currentJob = job;
    var timer = setInterval(function () {
      if (i >= steps.length) { clearInterval(timer); finishJob(job); return; }
      setJobProgress(steps[i][0], steps[i][1], steps[i][2]);
      i++;
    }, 1400);
  }

  function makeTitle(payload) {
    var base = payload.prompt.slice(0, 40);
    if (payload.mode === 'film' && payload.filmKind === 'continue') return 'Lanjutan: ' + base;
    return MODE_LABEL[payload.mode] + ': ' + base;
  }

  function statusLabel(status) {
    return { queued: '⏳ Antre...', generating: '🎬 Generating...', done: '✅ Selesai', failed: '❌ Gagal' }[status] || status;
  }
  function setJobProgress(pct, status, note) {
    $('job-progress').style.width = pct + '%';
    $('job-status').textContent = status + (pct ? ' ' + pct + '%' : '');
    $('job-note').textContent = note;
  }

  function finishJob(job) {
    setJobProgress(100, '✅ Selesai', 'Video kamu sudah jadi!');
    openResult(job);
    addHistory({
      id: job.id, mode: job.mode, title: job.title, prompt: job.prompt,
      videoUrl: job.videoUrl, createdAt: job.createdAt || new Date().toISOString(),
      durationSec: job.durationSec || job.duration || null,
      fileSize: job.fileSize || null
    });
  }

  function openResult(item) {
    showView('job');
    $('job-result').style.display = 'block';
    setJobProgress(100, '✅ Selesai', 'Video kamu sudah jadi!');
    $('result-video').src = item.videoUrl;
    $('result-title').textContent = item.title;
    var ks = $('job-key-source');
    if (item.usedProvider) {
      var pname = PROVIDER_NAMES[item.usedProvider] || item.usedProvider;
      ks.textContent = item.keySource === 'user'
        ? '🎥 Dibuat via ' + pname + ' (key kamu)'
        : item.keySource === 'server-default'
          ? '🎥 Dibuat via ' + pname + ' (key default server)'
          : '🎥 Dibuat via ' + pname + ' (demo)';
    } else {
      ks.textContent = '';
    }
    state.currentJob = item;
    setupDownload(item);
  }

  // ---------- Upload (stub) ----------
  document.querySelectorAll('.upload-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var platform = b.dataset.platform;
      var job = state.currentJob;
      if (!job) return;
      var connected = connectedPlatforms();
      if (!connected[platform]) {
        toast('Akun ' + platform + ' belum terhubung. Hubungkan dulu di tab Sosmed.');
        showView('social');
        return;
      }
      if (apiAvailable()) {
        fetch(apiUrl('/api/upload/' + platform), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: job.id })
        }).then(function (r) { return r.json(); })
          .then(function (d) { toast(d.message || 'Upload diproses.'); })
          .catch(function () { toast('Upload gagal — coba lagi.'); });
      } else {
        toast('Upload ke ' + platform + ': masih stub (butuh OAuth + backend).');
      }
    });
  });

  $('btn-again').addEventListener('click', function () {
    if (state.currentJob) openGenerate(state.currentJob.mode);
  });

  // ---------- Settings: provider + API key ----------
  // Key utuh TIDAK PERNAH dikirim balik ke client: server hanya mengembalikan
  // hasKey + last4 + status. Kolom tempel key selalu kosong saat dibuka.
  var PROVIDER_META_FALLBACK = [
    { id: 'runway', name: 'Runway', desc: 'Gen-4 Turbo — kualitas film, API resmi dev.runwayml.com', keyLabel: 'Runway API Key', keyHint: 'Tempel API key dari dev.runwayml.com.' },
    { id: 'kling', name: 'Kling AI', desc: 'Kling v1 — gerakan natural, auth JWT AccessKey + SecretKey', keyLabel: 'Kling AccessKey:SecretKey', keyHint: 'Tempel "ACCESS_KEY:SECRET_KEY" dari platform Kling.' },
    { id: 'luma', name: 'Luma Dream Machine', desc: 'Dream Machine — gerakan kamera sinematik, API lumalabs.ai', keyLabel: 'Luma API Key', keyHint: 'Tempel API key dari lumalabs.ai.' },
    { id: 'veo', name: 'Google Veo', desc: 'Veo 3 via Gemini API — video + audio, API key Google AI Studio', keyLabel: 'Google AI Studio API Key', keyHint: 'Tempel API key dari aistudio.google.com.' },
    { id: 'minimax', name: 'MiniMax / Hailuo', desc: 'Hailuo T2V-01 — video realistis, platform.minimax.chat', keyLabel: 'MiniMax API Key', keyHint: 'Tempel API key dari platform.minimax.chat.' },
    { id: 'custom', name: 'Custom (OpenAI-compatible)', desc: 'Endpoint video sendiri / proxy OpenAI-compatible — isi URL + model', keyLabel: 'API Key (Custom)', keyHint: 'Tempel API key endpoint custom kamu.', needsEndpoint: true },
    { id: 'mock', name: 'Demo (Mock)', desc: 'Video contoh lokal — tanpa API key, untuk mencoba alur', keyLabel: '—', keyHint: '' }
  ];
  var demoSettings = null; // mode demo: hanya last4 + status di memori sesi, key TIDAK disimpan

  function settingsBody(extra) {
    var b = Object.assign({ userId: userIdForApi() }, extra || {});
    if (tg && tg.initData) b.initData = tg.initData;
    return b;
  }

  function loadSettings() {
    if (!apiAvailable()) {
      $('settings-demo-note').style.display = 'block';
      if (!demoSettings) {
        demoSettings = {
          activeProvider: 'mock', fallbackEnabled: true, providers: {},
          textAI: { provider: 'Xingchi', configured: false, models: ['gpt-6-astra', 'gpt-6.1-sol'] }
        };
      }
      var data = Object.assign({}, demoSettings);
      data.providers = PROVIDER_META_FALLBACK.map(function (m) {
        return Object.assign({}, m, demoSettings.providers[m.id] || { hasKey: false, status: 'none' });
      });
      renderSettings(data, true);
      return;
    }
    $('settings-demo-note').style.display = 'none';
    fetch(apiUrl('/api/settings?userId=' + encodeURIComponent(userIdForApi())))
      .then(function (r) { return r.json(); })
      .then(function (d) { renderSettings(d, false); })
      .catch(function () { toast('Gagal memuat Settings — coba lagi.'); });
  }

  function renderSettings(data, isDemo) {
    // Baris status Text AI (Xingchi) — status saja, key tidak pernah tampil.
    var t = data.textAI || { provider: 'Xingchi', configured: false };
    var trow = $('textai-row');
    trow.innerHTML = '';
    var tdiv = document.createElement('div');
    tdiv.className = 'social-card';
    tdiv.innerHTML = '<span class="s-emoji">✍️</span>' +
      '<div class="s-info"><div class="s-name">Text AI: Xingchi</div>' +
      '<div class="s-status">' + (t.configured
        ? '✅ Terhubung — model gpt-6-astra / gpt-6.1-sol (teks/naskah saja, bukan render video)'
        : '⚪ Belum dikonfigurasi — naskah AI memakai template') + '</div></div>';
    trow.appendChild(tdiv);

    var sel = $('active-provider');
    sel.innerHTML = '';
    (data.providers || []).forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.id === 'mock' ? ' (demo)' : '');
      if (p.id === data.activeProvider) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = function () { setActiveProvider(sel.value, isDemo); };
    $('fallback-enabled').checked = !!data.fallbackEnabled;
    $('fallback-enabled').onchange = function () { setFallback($('fallback-enabled').checked, isDemo); };

    var box = $('provider-list');
    box.innerHTML = '';
    (data.providers || []).forEach(function (p) { box.appendChild(providerCard(p, isDemo)); });
  }

  function statusBadge(p) {
    if (!p.hasKey) return '<span class="status-badge none">Belum ada key</span>';
    if (p.status === 'ok') return '<span class="status-badge ok">OK ✓</span>';
    if (p.status === 'failed') return '<span class="status-badge failed">Gagal ✗</span>';
    return '<span class="status-badge untested">Belum dites</span>';
  }

  function providerCard(p, isDemo) {
    var card = document.createElement('div');
    card.className = 'provider-card';
    card.innerHTML = '<div class="provider-head"><span class="provider-name"></span>' + statusBadge(p) + '</div>' +
      '<div class="provider-desc"></div>';
    card.querySelector('.provider-name').textContent = p.name;
    card.querySelector('.provider-desc').textContent = p.desc + (p.envDefault ? ' • Key default server tersedia.' : '');
    if (p.id === 'mock') {
      var note = document.createElement('div');
      note.className = 'key-meta';
      note.textContent = 'Provider demo — tidak butuh API key, hasil video contoh.';
      card.appendChild(note);
      return card;
    }
    var keyMeta = document.createElement('div');
    keyMeta.className = 'key-meta';
    keyMeta.textContent = p.hasKey
      ? 'Key tersimpan: ••••' + p.last4 + (p.checkedAt ? ' • terakhir dites ' + new Date(p.checkedAt).toLocaleDateString('id-ID') : ' • belum dites')
      : 'Belum ada key tersimpan.';
    card.appendChild(keyMeta);

    var input = document.createElement('input');
    input.type = 'password';
    input.placeholder = p.keyHint || ('Tempel ' + p.keyLabel);
    input.autocomplete = 'off';
    card.appendChild(input);

    if (p.needsEndpoint) {
      var ep = document.createElement('input');
      ep.type = 'text';
      ep.placeholder = 'Endpoint URL (mis. https://api.contoh.com/v1)';
      ep.value = p.endpoint || '';
      ep.className = 'endpoint-input';
      card.appendChild(ep);
      var md = document.createElement('input');
      md.type = 'text';
      md.placeholder = 'Model (mis. video-1)';
      md.value = p.model || '';
      md.className = 'model-input';
      card.appendChild(md);
    }

    var row = document.createElement('div');
    row.className = 'provider-actions';
    var btnSave = document.createElement('button');
    btnSave.className = 'mini-btn';
    btnSave.textContent = '💾 Simpan Key';
    btnSave.addEventListener('click', function () {
      var key = input.value.trim();
      if (!key) { toast('Tempel dulu API key-nya.'); return; }
      var extra = {};
      if (p.needsEndpoint) {
        extra.endpoint = card.querySelector('.endpoint-input').value.trim();
        extra.model = card.querySelector('.model-input').value.trim();
      }
      saveProviderKey(p.id, key, extra, isDemo, function () { input.value = ''; });
    });
    var btnTest = document.createElement('button');
    btnTest.className = 'mini-btn ghost';
    btnTest.textContent = '🔌 Test Koneksi';
    btnTest.addEventListener('click', function () { testProviderKey(p.id, isDemo); });
    row.appendChild(btnSave);
    row.appendChild(btnTest);
    if (p.hasKey) {
      var btnDel = document.createElement('button');
      btnDel.className = 'mini-btn danger';
      btnDel.textContent = '🗑️ Hapus';
      btnDel.addEventListener('click', function () { deleteProviderKey(p.id, isDemo); });
      row.appendChild(btnDel);
    }
    card.appendChild(row);
    return card;
  }

  function apiPost(path, body, onOk) {
    fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsBody(body))
    }).then(function (r) { return r.json(); })
      .then(function (d) { onOk(d); })
      .catch(function () { toast('Gagal terhubung ke server.'); });
  }

  function saveProviderKey(providerId, key, extra, isDemo, done) {
    if (isDemo) {
      // Demo: JANGAN simpan nilai key — hanya last4 + status di memori sesi.
      demoSettings.providers[providerId] = { hasKey: true, last4: key.slice(-4), status: 'untested' };
      toast('Mode demo: key TIDAK disimpan (simulasi saja).');
      loadSettings();
      if (done) done();
      return;
    }
    apiPost('/api/settings/key', Object.assign({ provider: providerId, apiKey: key }, extra), function (d) {
      if (d && d.ok) { toast('Key ' + providerId + ' tersimpan terenkripsi.'); loadSettings(); }
      else toast('Gagal menyimpan key: ' + ((d && d.error) || 'error'));
      if (done) done();
    });
  }

  function testProviderKey(providerId, isDemo) {
    if (isDemo) { toast('Mode demo: test koneksi disimulasikan — OK.'); return; }
    toast('Mengetes koneksi ' + providerId + '...');
    apiPost('/api/settings/test', { provider: providerId }, function (d) {
      toast(d && d.message ? (d.ok ? '✅ ' : '❌ ') + d.message : 'Test selesai.');
      loadSettings();
    });
  }

  function deleteProviderKey(providerId, isDemo) {
    if (isDemo) {
      delete demoSettings.providers[providerId];
      loadSettings();
      return;
    }
    fetch(apiUrl('/api/settings/key'), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsBody({ provider: providerId }))
    }).then(function (r) { return r.json(); })
      .then(function () { toast('Key ' + providerId + ' dihapus.'); loadSettings(); })
      .catch(function () { toast('Gagal menghapus key.'); });
  }

  function setActiveProvider(providerId, isDemo) {
    if (isDemo) { demoSettings.activeProvider = providerId; toast('Mode demo: provider aktif = ' + providerId + ' (simulasi).'); return; }
    apiPost('/api/settings/active', { provider: providerId }, function (d) {
      if (d && d.ok) toast('Provider aktif: ' + providerId);
    });
  }

  function setFallback(enabled, isDemo) {
    if (isDemo) { demoSettings.fallbackEnabled = enabled; return; }
    apiPost('/api/settings/fallback', { enabled: enabled }, function () {});
  }

  // ---------- Init ----------
  initUser();
  renderSocial();
})();
