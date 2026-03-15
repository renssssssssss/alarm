/* ============================================================
   ALARM APP — app.js
   ============================================================ */

'use strict';

/* ------------------------------------------------------------
   Constants
   ------------------------------------------------------------ */
const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

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
let alarms      = [];   // { id, time, label, url, days, audioUrl, audioName, volume, active, fired }
let audioBlob   = null;
let audioUrl    = null;
let previewAudio = null;
let fireAudio   = null;

const selectedDays = new Set();


/* ------------------------------------------------------------
   Utility helpers
   ------------------------------------------------------------ */
function pad(n) {
  return String(n).padStart(2, '0');
}

function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg'))                          return 'edge';
  if (ua.includes('Chrome'))                       return 'chrome';
  if (ua.includes('Firefox'))                      return 'firefox';
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
    btn.className = 'day-btn';
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
   Audio file handling
   ------------------------------------------------------------ */
function applyAudioFile(file) {
  if (!file || !file.type.startsWith('audio/')) return;
  audioBlob = file;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(file);
  document.getElementById('file-name').textContent = file.name;
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
   Preview playback
   ------------------------------------------------------------ */
function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.currentTime = 0;
    previewAudio = null;
  }
  document.getElementById('stop-btn').hidden    = true;
  document.getElementById('preview-btn').hidden = false;
}

document.getElementById('preview-btn').addEventListener('click', () => {
  if (!audioUrl) { showToast('音声ファイルを選択してください'); return; }
  stopPreview();
  previewAudio = new Audio(audioUrl);
  previewAudio.volume = parseInt(document.getElementById('volume').value) / 100;
  previewAudio.play();
  previewAudio.addEventListener('ended', stopPreview);
  document.getElementById('preview-btn').hidden = true;
  document.getElementById('stop-btn').hidden    = false;
});

document.getElementById('stop-btn').addEventListener('click', stopPreview);


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
  const settingsUrls = { chrome: 'chrome://settings/content/popups', edge: 'edge://settings/content/popups' };
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

// Show banner when user fills in a URL
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

  const urlVal = document.getElementById('alarm-url').value.trim();

  const alarm = {
    id:        Date.now(),
    time:      `${pad(h)}:${pad(m)}`,
    label:     document.getElementById('alarm-label').value || `アラーム ${pad(h)}:${pad(m)}`,
    url:       urlVal,
    days:      [...selectedDays],
    audioUrl:  audioUrl,
    audioName: audioBlob ? audioBlob.name : null,
    volume:    parseInt(document.getElementById('volume').value, 10),
    active:    true,
    fired:     false,
  };

  alarms.push(alarm);
  renderAlarms();
  showToast('アラームを追加しました');

  // clear label field
  document.getElementById('alarm-label').value = '';

  if (urlVal) showPopupBanner();
});


/* ------------------------------------------------------------
   Render alarm list
   ------------------------------------------------------------ */
function renderAlarms() {
  const list  = document.getElementById('alarm-list');
  const empty = document.getElementById('empty-state');

  // remove existing alarm items
  list.querySelectorAll('.alarm-item').forEach(el => el.remove());

  if (alarms.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  // render newest first
  alarms.slice().reverse().forEach(alarm => {
    const item = buildAlarmItem(alarm);
    list.insertBefore(item, empty);
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
    alarm.audioName ? '音声あり' : 'ビープ音',
    alarm.url       ? 'URL付き'  : null,
  ].filter(Boolean);

  const item = document.createElement('div');
  item.className = 'alarm-item' + (alarm.active ? ' active' : '');
  item.dataset.id = alarm.id;
  item.innerHTML = `
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

  // disable one-shot alarms after firing
  if (alarm.days.length === 0) {
    alarm.active = false;
    renderAlarms();
  }
}

function playAlarmSound(alarm) {
  if (alarm.audioUrl) {
    fireAudio = new Audio(alarm.audioUrl);
    fireAudio.volume = alarm.volume / 100;
    fireAudio.loop = true;
    fireAudio.play().catch(() => {});
  } else {
    beep();
  }
}

function showFireOverlay(alarm) {
  document.getElementById('fire-time').textContent  = alarm.time;
  document.getElementById('fire-label').textContent = alarm.label;

  const urlBtn   = document.getElementById('fire-url-btn');
  const urlLabel = document.getElementById('fire-url-label');

  if (alarm.url) {
    urlBtn.href        = alarm.url;
    urlBtn.textContent = (alarm.url.length > 40 ? alarm.url.slice(0, 40) + '…' : alarm.url) + ' →';
    urlBtn.hidden      = false;
    urlLabel.textContent = 'クリックでURLを開きます';

    // attempt automatic open (succeeds if popups are already allowed)
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

  document.getElementById('fire-overlay').classList.add('show');
}

function dismissFireOverlay() {
  document.getElementById('fire-overlay').classList.remove('show');
  if (fireAudio) {
    fireAudio.pause();
    fireAudio.currentTime = 0;
    fireAudio = null;
  }
}

document.getElementById('fire-dismiss').addEventListener('click', dismissFireOverlay);
