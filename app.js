/* ============================================================
   ALARM APP — app.js
   ============================================================ */

'use strict';

/* ------------------------------------------------------------
   Constants
   ------------------------------------------------------------ */
const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ---- プリセット音声リスト ----
// 音声ファイルを追加・削除するときはここだけ編集してください。
// ファイルは sounds/ ディレクトリに配置してください。
const PRESET_SOUNDS = [
  { id: 'morning', label: 'Morning Bell', file: 'sounds/「さあ、いくぞ！」.mp3' },
  { id: 'digital', label: 'Digital Beep', file: 'sounds/「ついにお迎えが…」.mp3' },
  { id: 'chime',   label: 'Chime',        file: 'sounds/「もう…だめ…」.mp3'   },
  { id: 'birds',   label: 'Birds',        file: 'sounds/Pixel_Panic_Party.mp3'   },
];

const POPUP_GUIDE_STEPS = {
  chrome:  ['アドレスバー左の 🔒 アイコンをクリック', '「ポップアップとリダイレクト」→「許可」を選択'],
  firefox: ['アドレスバーの 🔒 アイコンをクリック', '「このサイトのポップアップを許可する」を選択'],
  safari:  ['Safari →「このWebサイトの設定」→ ポップアップを「許可」に変更'],
  edge:    ['アドレスバーの 🔒 アイコンをクリック', '「ポップアップ」→「許可」を選択'],
  other:   ['ブラウザのアドレスバー付近のアイコンからポップアップ許可を設定してください'],
};


/* ------------------------------------------------------------
   State
   ------------------------------------------------------------ */
let alarms       = [];   // { id, time, label, url, days, audioSrc, audioLabel, volume, autoStop, stopSec, active, fired }
let audioSrc     = null; // selected audio URL (preset path or blob URL)
let audioLabel   = null; // display name of selected audio
let audioBlobUrl = null; // blob URL from uploaded file (needs cleanup on change)
let previewAudio = null;
let fireAudio    = null;
let autoStopTimer = null;

const selectedDays = new Set();


/* ------------------------------------------------------------
   Utility helpers
   ------------------------------------------------------------ */
function pad(n) {
  return String(n).padStart(2, '0');
}

function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg'))                              return 'edge';
  if (ua.includes('Chrome'))                           return 'chrome';
  if (ua.includes('Firefox'))                          return 'firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  return 'other';
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.4, 0.8].forEach(offset => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.35);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.35);
    });
  } catch (e) {
    // Web Audio API unavailable
  }
}


/* ------------------------------------------------------------
   Clock & alarm polling
   ------------------------------------------------------------ */
function updateClock() {
  const now = new Date();
  const hh  = pad(now.getHours());
  const mm  = pad(now.getMinutes());
  const ss  = pad(now.getSeconds());

  document.getElementById('clock').textContent = `${hh}:${mm}:${ss}`;
  document.getElementById('date-display').textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 (${DAYS[now.getDay()]})`;

  checkAlarms(now);
}

function checkAlarms(now) {
  const curTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const curDay  = now.getDay();
  const curSec  = now.getSeconds();

  alarms.forEach(alarm => {
    if (!alarm.active) return;

    // reset fired flag when minute changes
    if (alarm.time !== curTime) { alarm.fired = false; return; }
    if (alarm.fired) return;

    const dayMatch = alarm.days.length === 0 || alarm.days.includes(curDay);
    if (!dayMatch) return;

    // fire within the first 3 seconds of the minute
    if (curSec < 3) {
      alarm.fired = true;
      fireAlarm(alarm);
    }
  });
}

setInterval(updateClock, 1000);
updateClock();


/* ------------------------------------------------------------
   Day-of-week buttons (dynamic rendering)
   ------------------------------------------------------------ */
function buildDayButtons() {
  const container = document.getElementById('days-row');
  DAYS.forEach((label, index) => {
    const btn = document.createElement('button');
    btn.className   = 'day-btn';
    btn.textContent = label;
    btn.dataset.day = index;
    btn.addEventListener('click', () => {
      if (selectedDays.has(index)) {
        selectedDays.delete(index);
        btn.classList.remove('on');
      } else {
        selectedDays.add(index);
        btn.classList.add('on');
      }
    });
    container.appendChild(btn);
  });
}
buildDayButtons();


/* ------------------------------------------------------------
   Audio source tabs (Preset / Upload)
   ------------------------------------------------------------ */
document.querySelectorAll('.audio-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.audio-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const target = tab.dataset.tab;
    document.getElementById('panel-preset').hidden = (target !== 'preset');
    document.getElementById('panel-upload').hidden = (target !== 'upload');

    stopPreview();
  });
});


/* ------------------------------------------------------------
   Preset sound list (defined in PRESET_SOUNDS constant above)
   ------------------------------------------------------------ */
function loadPresets() {
  const container = document.getElementById('preset-list');
  container.innerHTML = '';

  if (PRESET_SOUNDS.length === 0) {
    container.innerHTML = '<div class="preset-error">プリセット音声が登録されていません。app.js の PRESET_SOUNDS を編集してください。</div>';
    return;
  }

  PRESET_SOUNDS.forEach(sound => {
    const item = document.createElement('div');
    item.className  = 'preset-item';
    item.dataset.id = sound.id;
    item.innerHTML  = `
      <div class="preset-item-dot"></div>
      <div class="preset-item-label">${sound.label}</div>
      <button class="preset-item-play" aria-label="プレビュー">▶</button>
    `;

    // click row → select
    item.addEventListener('click', e => {
      if (e.target.classList.contains('preset-item-play')) return;
      selectPreset(item, sound.file, sound.label);
    });

    // preview button
    const playBtn = item.querySelector('.preset-item-play');
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      togglePresetPreview(sound.file, playBtn);
    });

    container.appendChild(item);
  });
}

function selectPreset(itemEl, src, label) {
  document.querySelectorAll('.preset-item').forEach(el => el.classList.remove('selected'));
  itemEl.classList.add('selected');
  audioSrc   = src;
  audioLabel = label;

  // release any uploaded blob
  if (audioBlobUrl) {
    URL.revokeObjectURL(audioBlobUrl);
    audioBlobUrl = null;
  }
}

function togglePresetPreview(src, btn) {
  // if already previewing this track, stop
  if (previewAudio && previewAudio.src.endsWith(encodeURIComponent(src).replace(/%2F/g, '/'))) {
    stopPreview();
    btn.textContent = '▶';
    return;
  }

  stopPreview();
  // reset all play buttons
  document.querySelectorAll('.preset-item-play').forEach(b => { b.textContent = '▶'; });

  previewAudio = new Audio(src);
  previewAudio.volume = parseInt(document.getElementById('volume').value) / 100;
  previewAudio.play().catch(() => showToast('音声ファイルが見つかりません'));
  previewAudio.addEventListener('ended', () => {
    btn.textContent = '▶';
    previewAudio = null;
  });
  btn.textContent = '■';
}

loadPresets();


/* ------------------------------------------------------------
   File upload handling
   ------------------------------------------------------------ */
function applyAudioFile(file) {
  if (!file || !file.type.startsWith('audio/')) return;

  if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
  audioBlobUrl = URL.createObjectURL(file);
  audioSrc     = audioBlobUrl;
  audioLabel   = file.name;

  document.getElementById('file-name').textContent = file.name;

  // deselect any preset
  document.querySelectorAll('.preset-item').forEach(el => el.classList.remove('selected'));
}

document.getElementById('audio-file').addEventListener('change', e => {
  applyAudioFile(e.target.files[0]);
});

document.getElementById('file-zone').addEventListener('dragover', e => {
  e.preventDefault();
});

document.getElementById('file-zone').addEventListener('drop', e => {
  e.preventDefault();
  applyAudioFile(e.dataTransfer.files[0]);
});


/* ------------------------------------------------------------
   Volume slider
   ------------------------------------------------------------ */
document.getElementById('volume').addEventListener('input', e => {
  document.getElementById('vol-out').textContent = e.target.value + '%';
});


/* ------------------------------------------------------------
   Preview playback (shared stop/start — used by upload tab)
   ------------------------------------------------------------ */
function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.currentTime = 0;
    previewAudio = null;
  }
  // reset all preset play buttons
  document.querySelectorAll('.preset-item-play').forEach(b => { b.textContent = '▶'; });
  document.getElementById('stop-btn').hidden    = true;
  document.getElementById('preview-btn').hidden = false;
}

document.getElementById('preview-btn').addEventListener('click', () => {
  if (!audioSrc) { showToast('音声を選択してください'); return; }
  stopPreview();
  previewAudio = new Audio(audioSrc);
  previewAudio.volume = parseInt(document.getElementById('volume').value) / 100;
  previewAudio.play().catch(() => showToast('音声ファイルが見つかりません'));
  previewAudio.addEventListener('ended', stopPreview);
  document.getElementById('preview-btn').hidden = true;
  document.getElementById('stop-btn').hidden    = false;
});

document.getElementById('stop-btn').addEventListener('click', stopPreview);


/* ------------------------------------------------------------
   Auto-stop setting
   ------------------------------------------------------------ */
const autostopToggle = document.getElementById('autostop-toggle');
const autostopDetail = document.getElementById('autostop-detail');
const autostopSecEl  = document.getElementById('autostop-sec');
const autostopSecOut = document.getElementById('autostop-sec-out');

autostopToggle.addEventListener('click', () => {
  const isOn = autostopToggle.classList.toggle('on');
  autostopDetail.hidden = !isOn;
});

autostopSecEl.addEventListener('input', () => {
  autostopSecOut.textContent = autostopSecEl.value + '秒';
});


/* ------------------------------------------------------------
   Popup permission banner
   ------------------------------------------------------------ */
const browser = detectBrowser();

function showPopupBanner() {
  const banner = document.getElementById('popup-banner');
  if (banner.dataset.dismissed) return;

  const steps = document.getElementById('banner-steps');
  steps.innerHTML = '';
  (POPUP_GUIDE_STEPS[browser] || POPUP_GUIDE_STEPS.other).forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    steps.appendChild(li);
  });

  banner.classList.add('show');
}

document.getElementById('btn-open-setting').addEventListener('click', () => {
  const settingsUrls = {
    chrome: 'chrome://settings/content/popups',
    edge:   'edge://settings/content/popups',
  };
  if (settingsUrls[browser]) {
    window.open(settingsUrls[browser], '_blank');
  } else {
    showToast('アドレスバー付近のアイコンから設定してください');
  }
  dismissBanner();
});

document.getElementById('btn-copy-url').addEventListener('click', () => {
  navigator.clipboard.writeText(location.href)
    .then(() => showToast('URLをコピーしました'));
});

document.getElementById('btn-dismiss-banner').addEventListener('click', dismissBanner);

function dismissBanner() {
  const banner = document.getElementById('popup-banner');
  banner.dataset.dismissed = '1';
  banner.classList.remove('show');
}

document.getElementById('alarm-url').addEventListener('blur', e => {
  if (e.target.value.trim()) showPopupBanner();
});


/* ------------------------------------------------------------
   Add alarm
   ------------------------------------------------------------ */
document.getElementById('add-btn').addEventListener('click', () => {
  const h = parseInt(document.getElementById('alarm-h').value, 10);
  const m = parseInt(document.getElementById('alarm-m').value, 10);

  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    showToast('時刻を正しく入力してください');
    return;
  }

  const urlVal     = document.getElementById('alarm-url').value.trim();
  const isAutoStop = autostopToggle.classList.contains('on');

  const alarm = {
    id:         Date.now(),
    time:       `${pad(h)}:${pad(m)}`,
    label:      document.getElementById('alarm-label').value || `アラーム ${pad(h)}:${pad(m)}`,
    url:        urlVal,
    days:       [...selectedDays],
    audioSrc:   audioSrc,
    audioLabel: audioLabel,
    volume:     parseInt(document.getElementById('volume').value, 10),
    autoStop:   isAutoStop,
    stopSec:    parseInt(autostopSecEl.value, 10),
    active:     true,
    fired:      false,
  };

  alarms.push(alarm);
  renderAlarms();
  showToast('アラームを追加しました');

  document.getElementById('alarm-label').value = '';
  if (urlVal) showPopupBanner();
});


/* ------------------------------------------------------------
   Render alarm list
   ------------------------------------------------------------ */
function renderAlarms() {
  const list  = document.getElementById('alarm-list');
  const empty = document.getElementById('empty-state');

  list.querySelectorAll('.alarm-item').forEach(el => el.remove());

  if (alarms.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  alarms.slice().reverse().forEach(alarm => {
    list.insertBefore(buildAlarmItem(alarm), empty);
  });
}

function buildAlarmItem(alarm) {
  const daysStr = alarm.days.length === 0
    ? '一度のみ'
    : alarm.days.length === 7
      ? '毎日'
      : alarm.days.map(d => DAYS[d]).join(' ');

  const metaParts = [
    daysStr,
    alarm.audioLabel || 'ビープ音',
    alarm.autoStop   ? `${alarm.stopSec}秒で停止` : null,
    alarm.url        ? 'URL付き' : null,
  ].filter(Boolean);

  const item = document.createElement('div');
  item.className  = 'alarm-item' + (alarm.active ? ' active' : '');
  item.dataset.id = alarm.id;
  item.innerHTML  = `
    <div class="alarm-item-time">${alarm.time}</div>
    <div class="alarm-item-info">
      <div class="alarm-item-label">${alarm.label}</div>
      <div class="alarm-item-meta">${metaParts.join(' · ')}</div>
    </div>
    <button class="alarm-toggle ${alarm.active ? 'on' : ''}" aria-label="オン/オフ"></button>
    <button class="alarm-del" aria-label="削除">✕</button>
  `;

  item.querySelector('.alarm-toggle').addEventListener('click', () => {
    alarm.active = !alarm.active;
    alarm.fired  = false;
    renderAlarms();
  });

  item.querySelector('.alarm-del').addEventListener('click', () => {
    alarms = alarms.filter(a => a.id !== alarm.id);
    renderAlarms();
    showToast('アラームを削除しました');
  });

  return item;
}


/* ------------------------------------------------------------
   Fire alarm
   ------------------------------------------------------------ */
function fireAlarm(alarm) {
  playAlarmSound(alarm);
  showFireOverlay(alarm);

  if (alarm.autoStop && alarm.stopSec > 0) {
    startAutoStopCountdown(alarm.stopSec);
  }

  // disable one-shot alarms after firing
  if (alarm.days.length === 0) {
    alarm.active = false;
    renderAlarms();
  }
}

function playAlarmSound(alarm) {
  if (alarm.audioSrc) {
    fireAudio = new Audio(alarm.audioSrc);
    fireAudio.volume = alarm.volume / 100;
    fireAudio.loop   = true;
    fireAudio.play().catch(() => {});
  } else {
    beep();
  }
}


/* ------------------------------------------------------------
   Fire overlay
   ------------------------------------------------------------ */
function showFireOverlay(alarm) {
  document.getElementById('fire-time').textContent  = alarm.time;
  document.getElementById('fire-label').textContent = alarm.label;

  const urlBtn   = document.getElementById('fire-url-btn');
  const urlLabel = document.getElementById('fire-url-label');

  if (alarm.url) {
    urlBtn.href          = alarm.url;
    urlBtn.textContent   = (alarm.url.length > 40 ? alarm.url.slice(0, 40) + '…' : alarm.url) + ' →';
    urlBtn.hidden        = false;
    urlLabel.textContent = 'クリックでURLを開きます';

    try {
      const newWindow = window.open(alarm.url, '_blank');
      if (newWindow) urlLabel.textContent = 'URLを自動で開きました';
    } catch (e) {
      // blocked — manual button remains visible
    }
  } else {
    urlBtn.hidden        = true;
    urlLabel.textContent = '';
  }

  const overlay = document.getElementById('fire-overlay');
  overlay.hidden = false;
  overlay.classList.add('show');
}

function dismissFireOverlay() {
  const overlay = document.getElementById('fire-overlay');
  overlay.classList.remove('show');
  overlay.hidden = true;

  stopAutoStopCountdown();

  if (fireAudio) {
    fireAudio.pause();
    fireAudio.currentTime = 0;
    fireAudio = null;
  }
}

document.getElementById('fire-dismiss').addEventListener('click', dismissFireOverlay);


/* ------------------------------------------------------------
   Auto-stop countdown (progress bar + label)
   ------------------------------------------------------------ */
function startAutoStopCountdown(seconds) {
  const autostopEl = document.getElementById('fire-autostop');
  const barEl      = document.getElementById('fire-autostop-bar');
  const labelEl    = document.getElementById('fire-autostop-label');

  autostopEl.hidden = false;

  // reset bar to full width, then animate to 0
  barEl.style.transition = 'none';
  barEl.style.width      = '100%';
  barEl.getBoundingClientRect(); // force reflow
  barEl.style.transition = `width ${seconds}s linear`;
  barEl.style.width      = '0%';

  let remaining = seconds;
  labelEl.textContent = `${remaining}秒後に自動停止`;

  autoStopTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(autoStopTimer);
      autoStopTimer = null;
      dismissFireOverlay();
    } else {
      labelEl.textContent = `${remaining}秒後に自動停止`;
    }
  }, 1000);
}

function stopAutoStopCountdown() {
  if (autoStopTimer) {
    clearInterval(autoStopTimer);
    autoStopTimer = null;
  }
  const autostopEl = document.getElementById('fire-autostop');
  if (autostopEl) autostopEl.hidden = true;
}