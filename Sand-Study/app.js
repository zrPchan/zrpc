// Minimal Sand Study app (ESM)
import * as storage from './src/storage.js';
import { createTimer } from './src/timer.js';
const UNIT_SEC = 37.5;
const BOTTLE_CAP = 100;
const AUTO_SAVE_TIME = 30; // seconds
const MAX_FIELD = 50; // max chars per field (taskname / insight / nexttask)
let sessionStart = null; // epoch seconds or null
let today = storage.loadToday();
// track last level used for theme-unlock detection
window._lastThemeUnlockLevel = Math.floor((today && today.bottlesCum ? Math.floor((today.bottlesCum||0)/2) : 0));
let countdownId = null;
let countdownRemaining = AUTO_SAVE_TIME;
let timerIntervalId = null; // legacy; kept for compatibility while migrating
let appTimer = null; // timer abstraction (created after updateTimerDisplay is defined)
let isRunning = false;
let elapsedStopped = 0; // seconds when paused
let TARGET_MINUTES = 5; // default target (minutes)
let TARGET_SECONDS = TARGET_MINUTES * 60;
const RING_CIRCUM = 2 * Math.PI * 88; // r=88 as in SVG
let overtimeAlerted = false;
let editingTaskId = null; // when non-null, end modal saves will update this task instead of creating a new one
let endModalOpenedAt = null; // epoch seconds recorded when end modal is shown (used as task end time)
let targetNotified = false; // guard to prevent repeated target notifications

render();

document.getElementById("startBtn").addEventListener("click", () => {
  sessionStart = now();
  // reset notification guard for this session so target alert can fire once
  targetNotified = false;
  // give feedback
  document.getElementById("startBtn").disabled = true;
  // initialize running countdown
  isRunning = true;
  elapsedStopped = 0;
  // Ensure audio context is allowed (user gesture) so playSE can produce sound
  try{ enableSound(); }catch(e){}
  // Request Notification permission on start (user gesture) so we can show a notification later
  try{
    if('Notification' in window && Notification.permission === 'default'){
      Notification.requestPermission().then(()=>{/* noop */});
    }
  }catch(e){/* ignore */}
  if(appTimer){ appTimer.setTarget(TARGET_SECONDS); appTimer.start(); } else { startTimerInterval(); }
  updateTargetUI();
  updateControlButtons();
  // Attempt push registration only if not currently registered. Do not block start flow on errors.
  try{ attemptPushRegisterIfNeeded(); }catch(e){ /* ignore */ }
});
// initialize ring dasharray on load so it's visible
(function initRing(){
  const ring = document.getElementById("progressRing");
  if(ring){
    ring.style.strokeDasharray = String(RING_CIRCUM);
    ring.style.strokeDashoffset = String(RING_CIRCUM);
  }
  // also initialize countdown display and target UI
  updateTargetUI();
  updateCountdownUI(TARGET_SECONDS, 0);
  // render logs on load
  try{ renderLogs(); }catch(e){/* ignore */}
})();

// --- Pro gating helpers (local simulation until real payment integration) ---
function isProUser(){ return localStorage.getItem('isPro') === '1'; }
function setProUser(flag){ localStorage.setItem('isPro', flag ? '1' : '0'); updateTargetUI(); }

// --- Environment: dev/prod mode helpers ---
function isDevMode(){
  try{
    // explicit toggle via localStorage (set 'dev' = '1' to force dev)
    if(localStorage.getItem('dev') === '1') return true;
    if(localStorage.getItem('dev') === '0') return false;
  }catch(e){}
  // common heuristics: localhost, URL flag (?dev=1 or ?dev=true or ?debug=1), or hash (#dev)
  try{
    if(location){
      const host = (location.hostname || '').toLowerCase();
      if(host === 'localhost' || host === '127.0.0.1') return true;
      const qs = location.search || '';
      // support ?dev=1, ?dev=true, ?debug=1
      if(/([?&])(dev=(1|true)|debug=1)($|&)/i.test(qs)) return true;
  // support hash flag like #dev or #dev=1 or #dev=true (match exact token to avoid accidental matches)
  const hash = (location.hash || '').toLowerCase();
  if(/^#dev(?:=(1|true))?$/i.test(hash)) return true;
    }
  }catch(e){}
  return false;
}
// Dev mode can be enabled manually via localStorage ('dev' = '1') or URL flag (?dev=1).
// NOTE: forced automatic setting removed by patch to restore normal behavior.
const DEV = isDevMode();
function setDevMode(flag){ try{ localStorage.setItem('dev', flag ? '1' : '0'); }catch(e){} window.location.reload(); }
window.setDevMode = setDevMode; // exposed for quick toggling
// expose DEV flag for debugging (both __DEV__ and DEV globals)
try{ window.__DEV__ = DEV; window.DEV = DEV; }catch(e){}

function showUpgradePrompt(){
  // Simple prompt for now — will be replaced by payment flow
  const ok = confirm('5分を超える目標時間は Pro 機能です。アップグレードしますか？');
  if(ok){
    // simulate purchase flow by setting local flag (in real app hook Stripe)
    setProUser(true);
    alert('Pro を有効にしました（ローカルシミュレーション）。');
  }
}

function setTargetMinutes(n){
  n = Math.max(1, Math.floor(n) || 1);
  // Prevent changing target while timer is actively running to avoid confusing behavior
  // Prevent changing target while a session exists (running or paused)
  if(sessionStart){
    try{ showToast('タイマー実行中または一時停止中は目標時間を変更できません'); }catch(e){}
    // reflect current value back into UI
    updateTargetUI();
    return;
  }

  if(!isProUser() && n > 5){
    // not allowed for free users
    showUpgradePrompt();
    if(!isProUser()) n = 5; // enforce cap
  }
  TARGET_MINUTES = n;
  TARGET_SECONDS = TARGET_MINUTES * 60;
  // update UI elements that display the target
  updateTargetUI();
  // ensure countdown visual reflects new target
  updateCountdownUI(TARGET_SECONDS, 0);
  if(appTimer){ appTimer.setTarget(TARGET_SECONDS); }
}

function updateTargetUI(){
  // update the small subtext under the countdown and input value
  const sub = document.querySelector('.countdown-sub');
  if(sub) sub.textContent = `/ ${String(TARGET_MINUTES)}分`;
  const inp = document.getElementById('targetMinutesInput');
  if(inp) inp.value = String(TARGET_MINUTES);
  // disable input while a session exists (running or paused) to avoid changing behavior mid-session
  try{ if(inp) inp.disabled = !!sessionStart; }catch(e){}
  const badge = document.getElementById('proBadge');
  if(badge) badge.textContent = isProUser() ? 'Pro' : 'Free';
  const upgradeBtn = document.getElementById('upgradeBtn');
  if(upgradeBtn){ upgradeBtn.textContent = isProUser() ? 'Pro（有効）' : 'Go Pro'; upgradeBtn.disabled = !!sessionStart; }
}

// Update control buttons (Start / Pause / Reset / End) enabled state based on session
function updateControlButtons(){
  try{
    const startBtn = document.getElementById('startBtn');
    const toggleBtn = document.getElementById('toggleRunBtn');
    const resetBtn = document.getElementById('resetSessionBtn');
    const endBtn = document.getElementById('endBtn');
    const hasSession = !!sessionStart;
    // When there is an active session (running or paused), Start should be disabled
    if(startBtn) startBtn.disabled = !!hasSession;
    // Pause/Resume, Reset, End should be disabled when there is no session
    if(toggleBtn) toggleBtn.disabled = !hasSession;
    if(resetBtn) resetBtn.disabled = !hasSession;
    if(endBtn) endBtn.disabled = !hasSession;
    // Ensure toggle text matches running state
    if(toggleBtn){ toggleBtn.textContent = (isRunning ? '一時停止' : '再開'); }
  }catch(e){/* ignore UI update errors */}
}
const endBtnMain = document.getElementById("endBtn");
if(endBtnMain){
  endBtnMain.addEventListener("click", ()=>{
    // Treat pressing End as completing the current run: stop timer and open end modal
    try{
      if(appTimer){ elapsedStopped = Math.min(appTimer.getElapsed(), TARGET_SECONDS); }
      else { elapsedStopped = sessionStart ? Math.min(now() - sessionStart, TARGET_SECONDS) : elapsedStopped; }
    }catch(e){}
    isRunning = false;
    if(appTimer){ appTimer.pause(); } else { stopTimerInterval(); }
    // open modal for manual save; ensure UI reflects stopped state
    openEndModal(false);
    try{ updateTargetUI(); }catch(e){}
    try{ updateControlButtons(); }catch(e){}
  });
}

function openEndModal(isAuto = false){
  // entering edit mode should be explicit; do NOT overwrite an editingTaskId
  // if the caller set it (edit flow sets editingTaskId before calling this).
  // Previously this function unconditionally cleared editingTaskId which prevented
  // edit flows from working and caused the cancel button to behave like "タスク続行".
  if(!sessionStart){ sessionStart = now(); }
  // record the time the end modal was opened so saved task end uses this
  try{ endModalOpenedAt = now(); }catch(e){ endModalOpenedAt = Date.now()/1000; }
  // Ensure any embedded overlays are hidden so they don't intercept touches/clicks
  try{
    const overlay = document.getElementById('resetConfirmOverlay');
    if(overlay && overlay.style.display !== 'none'){
      // If focus is inside overlay, blur it first to avoid aria-hidden warnings
      try{ const active = document.activeElement; if(active && overlay.contains(active)){ try{ active.blur(); }catch(e){} } }catch(e){}
      overlay.setAttribute('aria-hidden','true'); overlay.style.display = 'none';
    }
  }catch(e){}
  const dlg = document.getElementById("endModal");
  // showModal may not be supported in some embedded browsers / iOS WebView.
  try{
    if(typeof dlg.showModal === 'function'){
      dlg.showModal();
    } else {
      // fallback: display as positioned element
      dlg.style.display = 'block';
      dlg.classList.add('modal-fallback');
    }
  }catch(e){
    // fallback display when showModal throws
    dlg.style.display = 'block';
    dlg.classList.add('modal-fallback');
  }
  // Use user-configured auto-save seconds (0 = off)
  const autoSec = getAutoSaveSeconds();
  startCountdown(autoSec);
  // show a brief toast so iPhone users without console see the modal opened
  try{ showToast('記録ダイアログを表示'); }catch(e){}
  // initialize character counters for modal inputs
  function bindCounter(inputId, counterId){
    const inp = document.getElementById(inputId);
    const cnt = document.getElementById(counterId);
    if(!inp || !cnt) return;
    const update = ()=>{ cnt.textContent = String(Math.max(0, MAX_FIELD - (inp.value||'').length)); };
    // ensure maxlength enforced
    inp.setAttribute('maxlength', String(MAX_FIELD));
    inp.addEventListener('input', ()=>{
      if((inp.value||'').length > MAX_FIELD) inp.value = inp.value.slice(0, MAX_FIELD);
      update();
    });
    update();
  }
  bindCounter('taskname','tasknameCount');
  bindCounter('insight','insightCount');
  bindCounter('nexttask','nexttaskCount');
  const saveBtn = document.getElementById("saveBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  // add a passive visual flash and toast for touch devices to confirm taps
  if(saveBtn){
    saveBtn.addEventListener('click', ()=>{
      try{ saveBtn.classList.add('save-flash'); setTimeout(()=>saveBtn.classList.remove('save-flash'), 400); }catch(e){}
      try{ showToast('保存を実行中…'); }catch(e){}
    }, {passive:true});
  }
  if(DEV) console.log('openEndModal: modal opened, saveBtn=', !!saveBtn, 'cancelBtn=', !!cancelBtn, 'isAuto=', isAuto);
  if(saveBtn) saveBtn.onclick = (e) => { e.preventDefault(); confirmAndSave(); };
  if(cancelBtn){
    if(isAuto){
      // hide cancel when auto-completed
      cancelBtn.style.display = 'none';
      cancelBtn.onclick = null;
    } else {
      // If we're editing an existing log entry, show a simple 'キャンセル' that
      // only closes the modal (do not resume the timer or change running state).
      if(editingTaskId){
        cancelBtn.style.display = '';
        cancelBtn.textContent = 'キャンセル';
        cancelBtn.onclick = (e) => { e.preventDefault();
          // just close modal; keep timer stopped/unchanged
          closeModal();
        };
      } else {
        // show 'タスク続行' which closes modal and resumes
        cancelBtn.style.display = '';
        cancelBtn.textContent = 'タスク続行';
        cancelBtn.onclick = (e) => { e.preventDefault();
          // close modal and stop countdown, keep timer running
          closeModal();
          // ensure timer continues
          isRunning = true;
          startTimerInterval();
          // fix toggle button text to show "一時停止" when resuming
          const toggleBtn = document.getElementById('toggleRunBtn');
          if(toggleBtn) toggleBtn.textContent = '一時停止';
          updateControlButtons();
        };
      }
    }
  }
}

function closeModal(){
  const dlg = document.getElementById("endModal");
  try{ if(typeof dlg.close === 'function'){ dlg.close(); } else { dlg.style.display = 'none'; dlg.classList.remove('modal-fallback'); } }catch(e){ dlg.style.display = 'none'; dlg.classList.remove('modal-fallback'); }
  stopCountdown();
  // clear any recorded modal-open timestamp
  endModalOpenedAt = null;
}

function saveTaskAndClose(){
  if(DEV) console.log('saveTaskAndClose: called');
  stopCountdown();
  // If we're editing an existing task, perform an update instead of creating a new record
  if(editingTaskId){
    try{
      const updates = {
        mood: +val("mood"),
        effort: +val("effort"),
        taskname: (val("taskname") || '').trim(),
        insight: (val("insight") || '').trim(),
        nexttask: (val("nexttask") || '').trim(),
      };
      // Enforce per-field limits
      if(updates.taskname.length > MAX_FIELD) updates.taskname = updates.taskname.slice(0, MAX_FIELD);
      if(updates.insight.length > MAX_FIELD) updates.insight = updates.insight.slice(0, MAX_FIELD);
      if(updates.nexttask.length > MAX_FIELD) updates.nexttask = updates.nexttask.slice(0, MAX_FIELD);
  const ok = storage.updateTask(editingTaskId, updates);
      if(!ok){ showToast('編集の保存に失敗しました'); console.error('updateTask returned false'); return; }
      editingTaskId = null;
  // clear any recorded modal-open timestamp since edit completed
  endModalOpenedAt = null;
      try{ showToast('編集を保存しました'); }catch(e){}
    }catch(e){ console.error('saveTaskAndClose (edit) failed', e); try{ showToast('保存中にエラーが発生しました: ' + (e && e.message || e)); }catch(_){ } return; }
    // close modal and refresh
    try{ const dlgEl = document.getElementById("endModal"); if(dlgEl && typeof dlgEl.close === 'function'){ dlgEl.close(); } else if(dlgEl){ dlgEl.style.display = 'none'; dlgEl.classList.remove('modal-fallback'); } }catch(e){ }
    // Ensure logs reflect the update immediately
    try{ renderLogs(); }catch(e){}
    render();
    try{ updateTargetUI(); }catch(e){}
    try{ updateControlButtons(); }catch(e){}
    return;
  }

  // Use the time when the end modal was opened as the task end time if available.
  const end = (typeof endModalOpenedAt === 'number' && endModalOpenedAt) ? endModalOpenedAt : now();
  const elapsed = appTimer ? appTimer.getElapsed() : (sessionStart ? (end - sessionStart) : 0);
  const layer = elapsed < 60 ? 0 : Math.floor(elapsed / UNIT_SEC);
  // Safely generate an id even on older browsers
  const genId = (() => { try{ return (crypto && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : null; }catch(e){ return null; } })();
  const t = {
    id: genId || ('id-' + Date.now() + '-' + Math.floor(Math.random()*100000)),
  start: (end - elapsed) || end,
  end,
  elapsedSec: elapsed,
    layer,
    subject: "default",
    weekday: new Date().getDay(),
    mood: +val("mood"),
    effort: +val("effort"),
    taskname: val("taskname"),
    insight: val("insight"),
    nexttask: val("nexttask"),
    createdAt: end
  };

  // Enforce per-field limit (MAX_FIELD) for comments
  t.taskname = (t.taskname || '').trim();
  t.insight = (t.insight || '').trim();
  t.nexttask = (t.nexttask || '').trim();
  if(t.taskname.length > MAX_FIELD) t.taskname = t.taskname.slice(0, MAX_FIELD);
  if(t.insight.length > MAX_FIELD) t.insight = t.insight.slice(0, MAX_FIELD);
  if(t.nexttask.length > MAX_FIELD) t.nexttask = t.nexttask.slice(0, MAX_FIELD);

  try{
  if(DEV) console.log('saveTaskAndClose: task object', t);
  const ok = storage.saveTask(t);
    if(!ok){
      showToast('保存に失敗しました');
      console.error('saveTask returned false');
      return;
    }
  // Immediately refresh logs so the newly saved entry is visible without navigation
  try{ renderLogs(); }catch(e){}
  applyLayer(layer);
  sessionStart = null;
  if(appTimer) { try{ appTimer.stop(); }catch(e){ appTimer.pause && appTimer.pause(); } } else { stopTimerInterval(); }
    try{ showToast('保存しました'); }catch(e){}
    // clear recorded modal-open timestamp now that the task has been persisted
    endModalOpenedAt = null;
  }catch(e){
    console.error('saveTaskAndClose failed', e);
    try{ showToast('保存中にエラーが発生しました: ' + (e && e.message || e)); }catch(_){/* ignore */}
    return;
  }
  // reset countdown UI
  updateCountdownUI(TARGET_SECONDS, 0);
  hideOvertimeAlert();
  try{ const dlgEl = document.getElementById("endModal"); if(dlgEl && typeof dlgEl.close === 'function'){ dlgEl.close(); } else if(dlgEl){ dlgEl.style.display = 'none'; dlgEl.classList.remove('modal-fallback'); } }catch(e){ console.warn('endModal close failed', e); }
  clearInputs();
  render();
  try{ updateTargetUI(); }catch(e){}
  try{ updateControlButtons(); }catch(e){}
}

// Confirm and save: if combined comments exceed MAX_COMBINED, show modal warning
function confirmAndSave(){
  if(DEV) console.log('confirmAndSave: invoked');
  const taskname = (val('taskname') || '').trim();
  const insight = (val('insight') || '').trim();
  const nexttask = (val('nexttask') || '').trim();
  const warning = document.getElementById('truncateWarning');
  const text = document.getElementById('truncateText');
  // determine which fields will be truncated under MAX_FIELD policy
  const over = [];
  if(taskname.length > MAX_FIELD) over.push({k:'タスク名', from:taskname.length, to:MAX_FIELD});
  if(insight.length > MAX_FIELD) over.push({k:'気づき', from:insight.length, to:MAX_FIELD});
  if(nexttask.length > MAX_FIELD) over.push({k:'次のタスクのあいだに', from:nexttask.length, to:MAX_FIELD});

  if(over.length === 0){
    saveTaskAndClose();
    return;
  }
  if(!warning || !text){ saveTaskAndClose(); return; }
  // build a friendly warning message listing fields to be truncated
  const parts = over.map(o => `${o.k}: ${o.from} → ${o.to}文字`);
  text.textContent = `以下の項目が切り詰められます — ${parts.join('、')}。続行しますか？`;
  warning.style.display = '';
  const confirmBtn = document.getElementById('truncateConfirm');
  const cancelBtn = document.getElementById('truncateCancel');
  const cleanup = () => { if(confirmBtn) confirmBtn.onclick = null; if(cancelBtn) cancelBtn.onclick = null; };
  if(confirmBtn) confirmBtn.onclick = (e) => { e.preventDefault(); cleanup(); warning.style.display = 'none'; saveTaskAndClose(); };
  if(cancelBtn) cancelBtn.onclick = (e) => { e.preventDefault(); cleanup(); warning.style.display = 'none'; };
}

function showOvertimeAlert(){
  const el = document.getElementById('overtimeAlert');
  if(!el) return;
  el.style.display = 'block';
  overtimeAlerted = true;
  // disable pause/resume toggle while overtime
  const toggleBtn = document.getElementById('toggleRunBtn');
  if(toggleBtn) toggleBtn.disabled = true;
}

function hideOvertimeAlert(){
  const el = document.getElementById('overtimeAlert');
  if(!el) return;
  el.style.display = 'none';
  overtimeAlerted = false;
  // re-enable pause/resume toggle
  const toggleBtn = document.getElementById('toggleRunBtn');
  if(toggleBtn) toggleBtn.disabled = false;
}

function formatElapsed(sec){
  if(!Number.isFinite(sec) || sec < 0) return "00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if(h>0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function startTimerInterval(){
  // Legacy wrapper: start the appTimer if available, otherwise start the old interval
  if(appTimer){
    appTimer.setTarget(TARGET_SECONDS);
    // ensure sessionStart is in sync
    try{ const cur = appTimer.getElapsed(); sessionStart = now() - cur; }catch(e){}
    appTimer.start();
    // update immediately
    updateTimerDisplay();
    updateCountdown();
    return;
  }
  stopTimerInterval();
  // immediately update
  updateTimerDisplay();
  timerIntervalId = setInterval(()=>{
    updateTimerDisplay();
    updateCountdown();
  }, 1000);
}

function stopTimerInterval(){
  // Legacy: stop interval
  if(timerIntervalId){ clearInterval(timerIntervalId); timerIntervalId = null; }
  // If appTimer exists, stop it
  if(appTimer){ appTimer.stop(); }
  // reset display
  const el = document.getElementById("timerDisplay"); if(el) el.textContent = "00:00";
  // reflect UI changes when timer stops
  try{ updateTargetUI(); }catch(e){}
}

// Countdown specific helpers
function updateCountdown(){
  // Prefer using appTimer when available
  let elapsed = 0;
  if(appTimer){
    elapsed = appTimer.getElapsed();
  } else {
    if(sessionStart){ elapsed = isRunning ? (now() - sessionStart) : elapsedStopped; } else { elapsed = elapsedStopped; }
  }
  const cappedElapsed = Math.min(elapsed, TARGET_SECONDS);
  const remaining = Math.max(0, TARGET_SECONDS - cappedElapsed);
  updateCountdownUI(remaining, cappedElapsed);
  // Note: openEndModal on target and overtime are handled by timer callbacks when appTimer is used.
  if(!appTimer){
    if(cappedElapsed >= TARGET_SECONDS && isRunning){
      elapsedStopped = TARGET_SECONDS;
      isRunning = false;
      try{ notifyTargetReached(); }catch(e){}
      openEndModal(true);
    }
    if(!overtimeAlerted && elapsed > TARGET_SECONDS){ showOvertimeAlert(); try{ notifyTargetReached(); }catch(e){} }
  }
}

// Notify the user that the target has been reached: play sound, show notification and vibrate if available
function notifyTargetReached(){
  // prevent repeated notifications for the same target event
  if(targetNotified) return;
  targetNotified = true;
  try{ playSE(); }catch(e){/* ignore */}
  try{
    if(navigator && typeof navigator.vibrate === 'function'){
      // short vibration when available (mobile)
      try{ navigator.vibrate([200,100,150]); }catch(e){}
    }
  }catch(e){}
  try{
    if('Notification' in window){
      if(Notification.permission === 'granted'){
        // Prefer showing the notification via the Service Worker registration so that
        // notificationclick is handled by the SW even when the page is closed.
        try{
          notifyViaServiceWorker('Sand Study', { body: `目標時間 ${TARGET_MINUTES}分 に到達しました。記録しますか？`, tag: 'sandstudy-target', data: { targetMinutes: TARGET_MINUTES } });
        }catch(e){
          // Fallback to in-page Notification if SW not available
          try{
            const n = new Notification('Sand Study', { body: `目標時間 ${TARGET_MINUTES}分 に到達しました。記録しますか？`, tag: 'sandstudy-target' });
            n.onclick = (ev) => { try{ window.focus && window.focus(); }catch(e){}; try{ openEndModal(false); }catch(e){}; try{ n.close(); }catch(e){} };
          }catch(e){/* ignore */}
        }
      } else if(Notification.permission === 'default'){
        Notification.requestPermission().then(p => {
          if(p === 'granted'){
            try{ notifyViaServiceWorker('Sand Study', { body: `目標時間 ${TARGET_MINUTES}分 に到達しました。`, tag: 'sandstudy-target', data: { targetMinutes: TARGET_MINUTES } }); }catch(e){ /* ignore */ }
          }
        });
      }
    }
  }catch(e){/* ignore */}
}

// Try to show a notification via the active Service Worker registration so the SW
// can handle notificationclick even if the page is closed. Falls back to throwing
// an error if registration not found.
function notifyViaServiceWorker(title, options){
  if(!('serviceWorker' in navigator)) throw new Error('Service Worker not supported');
  return navigator.serviceWorker.getRegistration().then(reg => {
    if(!reg) throw new Error('No service worker registration found');
    return reg.showNotification(title, options || {});
  });
}

function updateCountdownUI(remainingSec, elapsedSec){
  const disp = document.getElementById("countdownDisplay");
  if(disp) disp.textContent = formatElapsed(remainingSec);
  // progress ring
  const progress = Math.min((elapsedSec / TARGET_SECONDS) * 100, 100);
  const offset = Math.round(RING_CIRCUM * (1 - progress / 100));
  const ring = document.getElementById("progressRing");
  if(ring) ring.style.strokeDashoffset = String(offset);
}

// Initialize timer abstraction (if not already) to handle ticking and target events.
if(!appTimer){
  appTimer = createTimer({
    targetSeconds: TARGET_SECONDS,
    onTick: (elapsed, remaining) => {
      try{ updateTimerDisplay(); }catch(e){}
      try{ updateCountdownUI(remaining, Math.min(elapsed, TARGET_SECONDS)); }catch(e){}
    },
    onTarget: () => {
      try{ notifyTargetReached(); }catch(e){}
      try{ openEndModal(true); }catch(e){}
    },
    onOvertime: (elapsed) => {
      if(!overtimeAlerted){ try{ showOvertimeAlert(); }catch(e){} try{ notifyTargetReached(); }catch(e){} }
    }
  });
}

// Toggle pause/resume button handling
const toggleBtn = document.getElementById("toggleRunBtn");
if(toggleBtn){
  toggleBtn.addEventListener("click", () =>{
    if(!sessionStart){ return; }
    if(isRunning){
      // pause
      if(appTimer){ appTimer.pause(); elapsedStopped = appTimer.getElapsed(); } else { elapsedStopped = now() - sessionStart; }
      isRunning = false;
      toggleBtn.textContent = "再開";
      updateTargetUI();
      updateControlButtons();
    } else {
      // resume
      // reset notification guard for resumed session so target alert can fire once
      targetNotified = false;
      if(appTimer){
        // sessionStart sync
        try{ const cur = appTimer.getElapsed(); sessionStart = now() - cur; }catch(e){}
        appTimer.start();
      } else {
        sessionStart = now() - (elapsedStopped || 0);
      }
      isRunning = true;
      toggleBtn.textContent = "一時停止";
      updateTargetUI();
      updateControlButtons();
    }
  });
}

const completeBtn = document.getElementById("completeBtn");
if(completeBtn){
  completeBtn.addEventListener("click", ()=>{
    // treat as complete: stop running and show modal
    isRunning = false;
    // ensure elapsedStopped holds final elapsed but cap at TARGET_SECONDS
    elapsedStopped = sessionStart ? Math.min(now() - sessionStart, TARGET_SECONDS) : elapsedStopped;
    openEndModal();
  });
}

function updateTimerDisplay(){
  const el = document.getElementById("timerDisplay");
  if(!el) return;
  // Prefer timer abstraction if available
  if(appTimer){
    const running = appTimer.isRunning();
    const elapsed = appTimer.getElapsed();
    if(!running && !elapsed){ el.textContent = "00:00"; return; }
    el.textContent = formatElapsed(Math.min(elapsed, TARGET_SECONDS));
    return;
  }
  // Fallback to legacy sessionStart/isRunning
  if(!sessionStart && !isRunning){ el.textContent = "00:00"; return; }
  if(!isRunning){ el.textContent = formatElapsed(Math.min(elapsedStopped, TARGET_SECONDS)); return; }
  const elapsed = now() - sessionStart;
  el.textContent = formatElapsed(Math.min(elapsed, TARGET_SECONDS));
}

function applyLayer(u){
  today.layerTotal = (today.layerTotal || 0) + u;
  const bottles = Math.floor(today.layerTotal / BOTTLE_CAP);
  today.bottlesToday = bottles;
  today.bottlesCum = storage.loadCumBase() + bottles;
  storage.saveToday(today);
}

function render(){
  document.getElementById("todayBottles").textContent = String(today.bottlesToday || 0);
  document.getElementById("cumBottles").textContent = String(today.bottlesCum || 0);
  // compute level from internal user data (bottlesCum) for robust unlock checks
  const newLevel = Math.floor((today.bottlesCum||0)/2);
  const levelEl = document.getElementById("level");
  if(levelEl) levelEl.textContent = String(newLevel);
  // detect unlock thresholds and apply random unlocks (new system)
  try{
    const prevLevel = Number(window._lastThemeUnlockLevel || 0);
    if(newLevel > prevLevel){
      // process any thresholds we've crossed
      try{ checkAndApplyNewUnlocks(); }catch(e){}
    }
    window._lastThemeUnlockLevel = newLevel;
  }catch(e){ /* noop */ }
  // render layered sand: up to 10 layers, each 10% of bottle height
  const layerWithin = (today.layerTotal || 0) % BOTTLE_CAP; // 0..99
  const fullLayers = Math.floor(layerWithin / 10); // number of full 10% layers
  const remainderLayer = layerWithin - fullLayers * 10; // 0..9 -> percent
  const sandEl = document.getElementById("sand");
  if(sandEl){
    // build layers bottom-up
    const maxLayers = 10;
    const layers = [];
          // color range (dark to light) — read from theme CSS variables so themes control sand colors
      const rootStyle = window.getComputedStyle(document.documentElement || document.body);
      let colorDark = (rootStyle.getPropertyValue('--sand-2') || '').trim() || '#cdb88a';
      let colorLight = (rootStyle.getPropertyValue('--sand-1') || '').trim() || '#efe6d1';
      const darkRgb = parseColorToRgb(colorDark);
      const lightRgb = parseColorToRgb(colorLight);
    // helper: parse #rrggbb or rgb(r,g,b)
    function parseColorToRgb(col){
      if(!col) return [205,184,138];
      col = col.trim();
      if(col.startsWith('#')){
        const h = col.replace('#','');
        return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
      }
      // rgb(...) or rgba(...)
      const m = col.match(/rgb\s*\(([^)]+)\)/);
      if(m && m[1]){
        const parts = m[1].split(',').map(p=>parseInt(p.trim()));
        return [parts[0]||0, parts[1]||0, parts[2]||0];
      }
      // fallback
      return [205,184,138];
    }
    function rgbToHex(r,g,b){
      return "#"+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
    }
    function lerp(a,b,t){ return Math.round(a + (b-a)*t); }

    // create full layers
    for(let i=0;i<fullLayers;i++){
      // position from bottom: i*10%
      const bottomPct = i * 10;
      const t = i / (maxLayers - 1);
      const r = lerp(darkRgb[0], lightRgb[0], t);
      const g = lerp(darkRgb[1], lightRgb[1], t);
      const b = lerp(darkRgb[2], lightRgb[2], t);
  const color = rgbToHex(r,g,b);
  // make base gradient more visible so layer shading reads through the grain
  const baseAlpha = 0.22; // stronger base alpha for clearer gradient
  const baseColorRgbaStart = `rgba(${r},${g},${b},${baseAlpha})`;
  // end color slightly darker to emphasize depth
  const baseColorRgbaEnd = `rgba(${Math.max(0,r-28)},${Math.max(0,g-28)},${Math.max(0,b-28)},${baseAlpha})`;
  // create a set of small, randomly positioned dots to simulate grain (non-aligned)
  // stronger, denser dots and use multiply blending so layers darken when stacked
  const dotAlpha = 0.50; // keep dot alpha so grain remains visible
  const dots = [];
  const dotCount = 60; // higher density per full layer
  for(let d=0; d<dotCount; d++){
    const px = Math.floor(Math.random()*100);
    const py = Math.floor(Math.random()*100);
  const size = (Math.random()*1.0 + 0.9).toFixed(2); // ~0.9-1.9px (slightly larger)
    dots.push(`radial-gradient(circle ${size}px at ${px}% ${py}%, rgba(${darkRgb[0]},${darkRgb[1]},${darkRgb[2]},${dotAlpha}) 0%, rgba(${darkRgb[0]},${darkRgb[1]},${darkRgb[2]},${dotAlpha}) 60%, transparent 61%)`);
  }
  const overlayStr = dots.join(',');
  const bgStyle = `background-image: ${overlayStr}, linear-gradient(${baseColorRgbaStart}, ${baseColorRgbaEnd}); background-repeat: no-repeat; background-size: auto, 100% 100%; background-blend-mode: multiply;`;
  layers.push(`<div class=\"sand-layer\" style=\"bottom:${bottomPct}%;height:10%;${bgStyle}\"></div>`);
    }
    // partial top layer
    if(remainderLayer > 0){
      const bottomPct = fullLayers * 10;
      const heightPct = remainderLayer; // since layerWithin layer equals percent
      const i = fullLayers;
      const t = i / (maxLayers - 1);
      const r = lerp(darkRgb[0], lightRgb[0], t);
      const g = lerp(darkRgb[1], lightRgb[1], t);
      const b = lerp(darkRgb[2], lightRgb[2], t);
  const color = rgbToHex(r,g,b);
  const dotAlpha = 0.50;
  const baseAlpha = 0.22;
  const baseColorRgbaStart = `rgba(${r},${g},${b},${baseAlpha})`;
  const baseColorRgbaEnd = `rgba(${Math.max(0,r-28)},${Math.max(0,g-28)},${Math.max(0,b-28)},${baseAlpha})`;
      const dots = [];
      const dotCount = 30; // increased density for partial top layer as well
      for(let d=0; d<dotCount; d++){
        const px = Math.floor(Math.random()*100);
        const py = Math.floor(Math.random()*100);
  const size = (Math.random()*1.0 + 0.9).toFixed(2);
        dots.push(`radial-gradient(circle ${size}px at ${px}% ${py}%, rgba(${darkRgb[0]},${darkRgb[1]},${darkRgb[2]},${dotAlpha}) 0%, rgba(${darkRgb[0]},${darkRgb[1]},${darkRgb[2]},${dotAlpha}) 60%, transparent 61%)`);
      }
      const overlayStr = dots.join(',');
  const bgStyle = `background-image: ${overlayStr}, linear-gradient(${baseColorRgbaStart}, ${baseColorRgbaEnd}); background-repeat: no-repeat; background-size: auto, 100% 100%; background-blend-mode: multiply;`;
      layers.push(`<div class="sand-layer partial" style="bottom:${bottomPct}%;height:${heightPct}%;${bgStyle}"></div>`);
    }
    sandEl.innerHTML = layers.join('');
  }
}

// When level crosses unlock thresholds, reveal themes and animate swatches
function handleThemeUnlocks(prevLevel, newLevel){
  try{
    const newlyUnlocked = (THEMES || []).filter(t => (t.unlock||0) > prevLevel && (t.unlock||0) <= newLevel);
    newlyUnlocked.forEach(t => {
      const id = t.id;
      const name = t.name || id;
      // update existing swatch if theme picker is open or element exists
      try{
        const sel = document.querySelector(`.theme-swatch[data-theme="${id}"]`);
        if(sel){
          sel.classList.remove('locked');
          sel.removeAttribute('data-unlock');
          sel.removeAttribute('aria-disabled');
          // ensure focusable/interactable
          sel.disabled = false;
        }
      }catch(e){}
      // global notification for user
      try{ showToast(`${name} テーマを解放しました！` , 2500); }catch(e){}
      // (no animation per user request)
    });
  }catch(e){ console.warn('handleThemeUnlocks error', e); }
}

function startCountdown(sec){
  stopCountdown();
  const el = document.getElementById("countdown");
  if(!sec || Number(sec) <= 0){
    // Auto-save disabled: clear display and do not start timer
    if(el) el.textContent = '';
    countdownRemaining = 0;
    return;
  }
  countdownRemaining = Number(sec);
  if(el) el.textContent = String(countdownRemaining);
  countdownId = setInterval(()=>{
    countdownRemaining -= 1;
    if(el) el.textContent = String(countdownRemaining);
    if(countdownRemaining <= 0){
      // auto-save
      stopCountdown();
      try{ saveTaskAndClose(); }catch(e){ console.error('auto save failed', e); }
    }
  }, 1000);
}

function stopCountdown(){ if(countdownId){ clearInterval(countdownId); countdownId=null; } }

function val(id){ return (document.getElementById(id) && document.getElementById(id).value) ? document.getElementById(id).value.trim() : ""; }
function byId(id){ return document.getElementById(id); }
function now(){ return Math.floor(Date.now()/1000); }

// ----- Web Push helpers -----
function urlBase64ToUint8Array(base64String) {
  // base64 url safe to Uint8Array (standard helper)
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeForPush(vapidPublicKey){
  if(!('serviceWorker' in navigator)) throw new Error('Service Worker not supported');
  const reg = await navigator.serviceWorker.ready;
  // ask permission if needed
  if('Notification' in window && Notification.permission !== 'granted'){
    const p = await Notification.requestPermission();
    if(p !== 'granted') { throw new Error('通知が許可されていません'); }
  }
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  // send subscription to server endpoint
  try{
    await fetch('/api/register-subscription', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(sub) });
  }catch(e){ console.warn('failed to register subscription on server', e); }
  localStorage.setItem('pushSubscription', JSON.stringify(sub));
  showToast('Push通知を登録しました');
  try{ if(DEV) console.log('push subscription', sub); }catch(e){}
}

// Attempt to register for push if not already subscribed.
// This is safe to call from the Start button: it will do nothing if the user
// already has a subscription, and it will not block the main timer flow.
async function attemptPushRegisterIfNeeded(){
  try{
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    if(!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if(sub) return; // already subscribed

    // Try fetching public key from server endpoints used elsewhere in app
    let key = null;
    try{ const r = await fetch('/api/vapidPublicKey'); if(r.ok) key = await r.text(); }catch(_){ }
    if(!key){ try{ const r2 = await fetch('/vapidPublicKey'); if(r2.ok) key = await r2.text(); }catch(_){ } }
    if(!key){
      // no key available from server; do NOT prompt the user when called from Start button.
      // Silent skip so the start flow isn't interrupted with modal prompts.
      if(DEV) try{ console.log('No VAPID public key available; skipping push registration'); }catch(e){}
    }
    if(!key) return; // user cancelled or no key

    try{ await subscribeForPush(key.trim()); }catch(e){ console.warn('attemptPushRegisterIfNeeded failed', e); }
  }catch(e){ console.warn('attemptPushRegisterIfNeeded unexpected error', e); }
}

async function unsubscribePush(){
  if(!('serviceWorker' in navigator)) throw new Error('Service Worker not supported');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if(!sub){ showToast('登録された Push が見つかりません'); return; }
  try{
    await fetch('/api/unregister-subscription', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(sub) });
  }catch(e){ /* ignore server failure */ }
  await sub.unsubscribe();
  localStorage.removeItem('pushSubscription');
  showToast('Push通知を解除しました');
}

// expose helpers for manual testing
try{ window.subscribeForPush = subscribeForPush; window.unsubscribePush = unsubscribePush; }catch(e){}

// --- Favorites (preset target minutes) ---
const FAV_KEY = 'favTargets:v1';
function loadFavs(){ try{ const s = localStorage.getItem(FAV_KEY); return s ? JSON.parse(s) : []; }catch(e){ return []; } }
function saveFavs(arr){ try{ localStorage.setItem(FAV_KEY, JSON.stringify(arr)); }catch(e){}
  renderFavList(); }

function renderFavList(){
  const listEl = document.getElementById('favList'); if(!listEl) return;
  const arr = loadFavs();
  if(arr.length === 0){ listEl.innerHTML = '<div class="log-empty">お気に入りがありません</div>'; return; }
  listEl.innerHTML = arr.map(v => {
    return `<div class="fav-item" data-min="${v}"><div class="fav-label">${v} 分</div><div class="fav-actions-inner"><button class="fav-use" data-min="${v}">選択</button><button class="fav-remove" data-min="${v}">削除</button></div></div>`;
  }).join('');
}

function openFavs(){
  const overlay = document.getElementById('favoritesOverlay');
  const popup = document.getElementById('favoritesPopup');
  if(overlay && popup){
    overlay.setAttribute('aria-hidden','false');
    overlay.style.display = 'flex';
    popup.setAttribute('aria-hidden','false');
    renderFavList();
    const inp = document.getElementById('favMinutesInput'); if(inp) try{ inp.focus(); }catch(e){}
    // Bind overlay close (click outside) and Esc handler once
    if(!window._favOverlayBound){
      window._favOverlayBound = true;
      try{ overlay.addEventListener('click', (ev)=>{ if(ev.target === overlay) closeFavs(); }); }catch(e){}
      try{ document.addEventListener('keydown', (ev)=>{ if(ev.key === 'Escape'){ const ov = document.getElementById('favoritesOverlay'); if(ov && ov.style.display !== 'none'){ closeFavs(); } } }); }catch(e){}
    }
    return;
  }
  // fallback: previous behavior when overlay not present
  const p = document.getElementById('favoritesPopup'); if(!p) return; p.setAttribute('aria-hidden','false'); p.style.display = 'block'; renderFavList(); const inp = document.getElementById('favMinutesInput'); if(inp) try{ inp.focus(); }catch(e){}
}
function closeFavs(){
  const overlay = document.getElementById('favoritesOverlay');
  const popup = document.getElementById('favoritesPopup');
  if(overlay && popup){
    overlay.setAttribute('aria-hidden','true');
    overlay.style.display = 'none';
    popup.setAttribute('aria-hidden','true');
    // restore focus to open button
    try{ const favOpen = document.getElementById('favOpenBtn'); if(favOpen && typeof favOpen.focus === 'function') favOpen.focus(); }catch(e){}
    return;
  }
  const p = document.getElementById('favoritesPopup'); if(!p) return; p.setAttribute('aria-hidden','true'); p.style.display = 'none';
}

document.addEventListener('click', (ev)=>{
  // delegation for fav use/remove
  const useBtn = ev.target.closest && ev.target.closest('.fav-use');
  if(useBtn){ const m = Number(useBtn.getAttribute('data-min')); if(m){ setTargetMinutes(m); closeFavs(); } return; }
  const remBtn = ev.target.closest && ev.target.closest('.fav-remove');
  if(remBtn){ const m = Number(remBtn.getAttribute('data-min')); if(!m) return; const arr = loadFavs().filter(x=>x!==m); saveFavs(arr); return; }
});

// Bind fav UI controls
try{
  const favOpen = document.getElementById('favOpenBtn'); if(favOpen) favOpen.addEventListener('click', ()=>{ openFavs(); });
  const favClose = document.getElementById('favCloseBtn'); if(favClose) favClose.addEventListener('click', ()=>{ closeFavs(); });
  const favAdd = document.getElementById('favAddBtn'); if(favAdd){ favAdd.addEventListener('click', ()=>{
    const inp = document.getElementById('favMinutesInput'); if(!inp) return; const v = Number(inp.value || 0); if(!v || v < 1) { showToast('有効な分数を入力してください'); return; }
    let arr = loadFavs(); if(arr.indexOf(v) === -1){ arr.push(v); arr.sort((a,b)=>a-b); saveFavs(arr); }
    inp.value = '';
  }); }
  // also allow double-clicking existing fav item label to use
  const favListEl = document.getElementById('favList'); if(favListEl){ favListEl.addEventListener('dblclick', (ev)=>{ const item = ev.target.closest && ev.target.closest('.fav-item'); if(!item) return; const m = Number(item.getAttribute('data-min')); if(m){ setTargetMinutes(m); closeFavs(); } }); }
}catch(e){/* ignore binding errors */}

// Bind ring color picker controls (in theme popup)
try{
  const ringInput = document.getElementById('ringColorInput');
  const ringReset = document.getElementById('ringColorReset');
  const ringCustomBtn = document.getElementById('ringColorCustomBtn');
  if(ringInput){
    // initialize input to current computed ring color (either saved custom or theme default)
    try{
      const cs = getComputedStyle(document.documentElement);
      let cur = cs.getPropertyValue('--ring-color') || cs.getPropertyValue('--accent');
      cur = (cur||'').trim();
      // if value is a rgb() form, try to convert? we just set the input to hex fallback if empty
      if(cur && cur.indexOf('rgb') === -1) ringInput.value = cur;
    }catch(e){}
    ringInput.addEventListener('input', (ev)=>{ try{ const v = ev.target.value; if(v) applyRingColor(v);
        // update custom swatch visual
        try{ if(ringCustomBtn){ ringCustomBtn.setAttribute('data-color', v); const ss = ringCustomBtn.querySelector('.swatch-sample'); if(ss) ss.style.background = v; } }catch(e){}
      }catch(e){} });
  }
  if(ringReset){ ringReset.addEventListener('click', ()=>{ try{ applyRingColor(null); // remove custom
      // update input to reflect theme-default value
      try{ const cs = getComputedStyle(document.documentElement); let def = cs.getPropertyValue('--ring-color') || cs.getPropertyValue('--accent'); def = (def||'').trim(); if(ringInput && def) ringInput.value = def; // update visual
        if(ringCustomBtn && def) { ringCustomBtn.setAttribute('data-color', def); const ss = ringCustomBtn.querySelector('.swatch-sample'); if(ss) ss.style.background = def; }
      }catch(e){}
    }catch(e){} }); }
  // open native color picker when custom swatch pressed
  try{ if(ringCustomBtn && ringInput){ ringCustomBtn.addEventListener('click', ()=>{ try{ ringInput.click(); }catch(e){ try{ /* fallback: focus */ ringInput.focus(); }catch(e){} } }); } }catch(e){}
}catch(e){/* ignore */}


// --- Theme picker: palettes (basic / solid × sand, red, blue, green, pink, silver)
const THEME_KEY = 'uiTheme:v1';
const BG_THEME_KEY = 'uiBgTheme:v1';
const RING_COLOR_KEY = 'uiRingColor:v1';
// Unlock progression state (saved in localStorage)
const UNLOCK_STATE_KEY = 'uiUnlockState:v1';
// thresholds at which a single random unlock occurs (can be extended)
const UNLOCK_THRESHOLDS = [3,5,7,10,12,15,17,20,22,25];

// Structure saved under UNLOCK_STATE_KEY:
// { processedUpToLevel: number, sand: [ids], bg: [ids], ring: [ids] }

function loadUnlockState(){
  try{
    const raw = localStorage.getItem(UNLOCK_STATE_KEY);
    if(!raw) return { processedUpToLevel: 0, sand: ['sand'], bg: ['sand'], ring: ['sand'] };
    return JSON.parse(raw);
  }catch(e){ return { processedUpToLevel: 0, sand: ['sand'], bg: ['sand'], ring: ['sand'] }; }
}

function saveUnlockState(state){
  try{ localStorage.setItem(UNLOCK_STATE_KEY, JSON.stringify(state)); }catch(e){}
}

// Utility to check if all items unlocked
function allUnlocked(state){
  try{
    const total = THEMES.length;
    return (state.sand.length >= total) && (state.bg.length >= total) && (state.ring.length >= total);
  }catch(e){ return false; }
}

// Get current numeric level from DOM or fallback to 0
function getCurrentLevel(){
  try{
    const el = document.getElementById('level');
    if(el) return Number((el.textContent||'0').trim())||0;
    return 0;
  }catch(e){ return 0; }
}

// Randomly unlock one item (sand/bg/ring) from remaining locked pools
function performRandomUnlockForThreshold(state, threshold){
  try{
    // build pools
    const allIds = THEMES.map(t=>t.id);
    const lockedSand = allIds.filter(id => state.sand.indexOf(id) === -1);
    const lockedBg = allIds.filter(id => state.bg.indexOf(id) === -1);
    const lockedRing = allIds.filter(id => state.ring.indexOf(id) === -1);
    const pools = [];
    if(lockedSand.length) pools.push({type:'sand', pool:lockedSand});
    if(lockedBg.length) pools.push({type:'bg', pool:lockedBg});
    if(lockedRing.length) pools.push({type:'ring', pool:lockedRing});
    if(pools.length === 0) return state; // nothing to unlock
    // pick a random pool, weighted equally
    const p = pools[Math.floor(Math.random()*pools.length)];
    const pick = p.pool[Math.floor(Math.random()*p.pool.length)];
    if(p.type === 'sand') state.sand.push(pick);
    else if(p.type === 'bg') state.bg.push(pick);
    else if(p.type === 'ring') state.ring.push(pick);
    // notify
    try{ showToast(`Lv ${threshold} で ${p.type === 'sand' ? '砂色' : p.type === 'bg' ? '背景' : 'タイマーリング'} の「${pick}」が解放されました` , 3000); }catch(e){}
    return state;
  }catch(e){ console.warn('performRandomUnlockForThreshold failed', e); return state; }
}

// Process thresholds between processedUpToLevel and current level
function checkAndApplyNewUnlocks(){
  try{
    const state = loadUnlockState();
    const cur = getCurrentLevel();
    // find thresholds > processedUpToLevel and <= cur
    const toProcess = UNLOCK_THRESHOLDS.filter(x => x > (state.processedUpToLevel||0) && x <= cur);
    if(toProcess.length === 0) return;
    toProcess.forEach(th => {
      performRandomUnlockForThreshold(state, th);
      state.processedUpToLevel = th;
    });
    saveUnlockState(state);
    // re-render theme grids and ring presets to reflect newly unlocked items
    try{ renderThemeGrid(); }catch(e){}
    try{ renderRingPresets(); }catch(e){}
    // if fully unlocked, enable color picker
    try{ updateRingPickerEnabledState(); }catch(e){}
  }catch(e){ console.warn('checkAndApplyNewUnlocks failed', e); }
}

// Enable/disable ring color custom UI based on full unlock state
function updateRingPickerEnabledState(){
  try{
    const state = loadUnlockState();
    const enabled = allUnlocked(state);
    const ringInput = document.getElementById('ringColorInput');
    const ringBtn = document.getElementById('ringColorCustomBtn');
    if(ringInput) ringInput.disabled = !enabled;
    if(ringBtn) ringBtn.disabled = !enabled;
    // visually indicate disabled via attribute (CSS can style .theme-swatch[disabled])
    if(ringBtn){ if(enabled) ringBtn.classList.remove('locked'); else ringBtn.classList.add('locked'); }
  }catch(e){}
}
// Preset colors for ring picker (mapped to theme ids)
const RING_PRESETS = { sand:'#d6b77a', red:'#e05a6a', blue:'#4a8fe0', green:'#34a853', pink:'#f47aa6', silver:'#9aa6b3' };
const THEMES = [
  // Basic themes with unlock levels (0 = unlocked by default)
  {id:'sand', name:'Sand', c1:'#fffaf5', c2:'#fff6ec', unlock:0},
  {id:'red', name:'Red', c1:'#fff6f6', c2:'#fff1f1', unlock:3},
  {id:'blue', name:'Blue', c1:'#f6fbff', c2:'#eef7ff', unlock:5},
  {id:'green', name:'Green', c1:'#f6fff6', c2:'#f0fff0', unlock:7},
  {id:'pink', name:'Pink', c1:'#fff7fb', c2:'#fff2f8', unlock:10},
  {id:'silver', name:'Silver', c1:'#f7f8fa', c2:'#eef0f3', unlock:12}
];

function applyThemeId(id){
  try{
    const root = document.documentElement || document.body;
    if(window._currentThemeClass){ try{ root.classList.remove(window._currentThemeClass); }catch(e){} }
    // normalize legacy ids and accept either full class (starts with 'theme-') or id suffix
    let raw = String(id || '');
    // if passed a full class like 'theme-basic-sand', strip leading 'theme-'
    if(raw.startsWith('theme-')) raw = raw.slice(6);
    // handle legacy prefixes 'basic-' and 'solid-'
    if(raw.startsWith('basic-')) raw = raw.slice(6);
    if(raw.startsWith('solid-')) raw = raw.slice(6);
    // final class to add
    const cls = 'theme-' + raw;
    try{ root.classList.add(cls); window._currentThemeClass = cls; }catch(e){}
    try{ localStorage.setItem(THEME_KEY, raw); }catch(e){}
    // re-render UI (to pick up theme-driven styles such as sand colors)
    try{ if(typeof render === 'function') render(); }catch(e){}
  }catch(e){ console.warn('applyThemeId failed', e); }
}

function applyBgThemeId(id){
  try{
    const root = document.documentElement || document.body;
    if(window._currentBgThemeClass){ try{ root.classList.remove(window._currentBgThemeClass); }catch(e){} }
    let raw = String(id || '');
    if(raw.startsWith('bg-theme-')) raw = raw.slice(9);
    if(raw.startsWith('theme-')) raw = raw.slice(6);
    const cls = 'bg-theme-' + raw;
    try{ root.classList.add(cls); window._currentBgThemeClass = cls; }catch(e){}
    try{ localStorage.setItem(BG_THEME_KEY, raw); }catch(e){}
    try{ if(typeof render === 'function') render(); }catch(e){}
  }catch(e){ console.warn('applyBgThemeId failed', e); }
}

// Allow user to set a custom ring color which overrides theme defaults.
function applyRingColor(color){
  try{
    const root = document.documentElement || document.body;
    if(!color){
      // remove custom and let CSS theme vars take effect
      try{ root.style.removeProperty('--ring-color'); }catch(e){}
      try{ localStorage.removeItem(RING_COLOR_KEY); }catch(e){}
      return;
    }
    // ensure the color is a string like '#rrggbb' or valid CSS color
    try{ root.style.setProperty('--ring-color', String(color)); }catch(e){}
    try{ localStorage.setItem(RING_COLOR_KEY, String(color)); }catch(e){}
  }catch(e){ console.warn('applyRingColor failed', e); }
}

function renderThemeGrid(){
  const grid = document.getElementById('themeGrid'); if(!grid) return;
  // determine current user level from internal data (today.bottlesCum) so picker reflects unlocks even when overlay opened before UI render
  let level = 0;
  try{
    level = Math.floor((today && today.bottlesCum ? (today.bottlesCum||0) : (storage.loadCumBase()||0)) / 2) || 0;
  }catch(e){ level = 0; }

  // respect unlock state: sand-type unlocks
  const unlockState = loadUnlockState();
  grid.innerHTML = THEMES.map(t => {
    const locked = (unlockState.sand.indexOf(t.id) === -1);
    const lockClass = locked ? ' locked' : '';
    const aria = locked ? ` aria-disabled="true" title="Lv で解放されます"` : ` title="${t.name}"`;
    return `<button class="theme-swatch${lockClass}" data-theme="${t.id}" type="button"${aria}><span class="swatch-sample" style="background:linear-gradient(90deg, ${t.c1}, ${t.c2})"></span><div class="swatch-label">${t.name}${locked?'<div class="swatch-lock">🔒</div>':''}</div></button>`;
  }).join('');

  // Also populate background theme grid (if present) with the same swatches
  try{
    const bgGrid = document.getElementById('bgThemeGrid');
    if(bgGrid){
      const unlockStateBg = unlockState;
      bgGrid.innerHTML = THEMES.map(t => {
        const locked = (unlockStateBg.bg.indexOf(t.id) === -1);
        const lockClass = locked ? ' locked' : '';
        const aria = locked ? ` aria-disabled="true" title="Lv で解放されます"` : ` title="${t.name}"`;
        return `<button class="theme-swatch${lockClass}" data-theme="${t.id}" type="button"${aria}><span class="swatch-sample" style="background:linear-gradient(90deg, ${t.c1}, ${t.c2})"></span><div class="swatch-label">${t.name}${locked?'<div class="swatch-lock">🔒</div>':''}</div></button>`;
      }).join('');
    }
  }catch(e){/* ignore */}
}

function openThemes(){
  const overlay = document.getElementById('themeOverlay');
  const popup = document.getElementById('themePopup');
  if(!overlay || !popup) return;
  overlay.setAttribute('aria-hidden','false'); overlay.style.display = 'flex'; popup.setAttribute('aria-hidden','false');
  renderThemeGrid();
  try{ renderRingPresets(); }catch(e){}
  if(!window._themeOverlayBound){
    window._themeOverlayBound = true;
    try{ overlay.addEventListener('click', (ev)=>{ if(ev.target === overlay) closeThemes(); }); }catch(e){}
    try{ document.addEventListener('keydown', (ev)=>{ if(ev.key === 'Escape'){ const ov = document.getElementById('themeOverlay'); if(ov && ov.style.display !== 'none'){ closeThemes(); } } }); }catch(e){}
  }
}

// Render ring color preset swatches into the theme popup
function renderRingPresets(){
  try{
    const container = document.getElementById('ringColorPresets');
    if(!container) return;
    const input = document.getElementById('ringColorInput');
    const saved = (function(){ try{ return (localStorage.getItem(RING_COLOR_KEY)||'').trim().toLowerCase(); }catch(e){ return ''; }})();
    // Render same style swatches as the theme grid so buttons look identical
    const unlockState = loadUnlockState();
    container.innerHTML = THEMES.map(t => {
      const color = RING_PRESETS[t.id] || t.c2 || t.c1 || '#cccccc';
      // locked if this ring preset hasn't been unlocked yet
      const locked = (unlockState.ring.indexOf(t.id) === -1);
      const pressed = (saved && saved === color.trim().toLowerCase()) ? ' aria-pressed="true"' : '';
      const lockClass = locked ? ' locked' : '';
      const aria = locked ? ` aria-disabled="true" title="解放されるまで使用できません"` : ` title="${t.name}"`;
      return `<button class="theme-swatch${lockClass}" type="button" data-theme="${t.id}" data-color="${color}"${pressed}${aria}><span class="swatch-sample" style="background:linear-gradient(90deg, ${t.c1}, ${t.c2})"></span><div class="swatch-label">${t.name}${locked?'<div class="swatch-lock">🔒</div>':''}</div></button>`;
    }).join('');

    // delegate clicks to the container so newly created buttons respond
    container.onclick = function(ev){
      try{
        const btn = ev.target.closest && ev.target.closest('.theme-swatch');
        if(!btn) return;
        // ignore clicks on locked presets
        if(btn.classList.contains('locked')) return;
        const id = btn.getAttribute('data-theme');
        const color = btn.getAttribute('data-color');
        if(color){
          applyRingColor(color);
          if(input) input.value = color;
          // update aria-pressed state
          Array.from(container.querySelectorAll('.theme-swatch')).forEach(c=>{ try{ c.setAttribute('aria-pressed','false'); }catch(e){} });
          try{ btn.setAttribute('aria-pressed','true'); }catch(e){}
        }
      }catch(e){ console.warn('ring preset delegation failed', e); }
    };
  }catch(e){ console.warn('renderRingPresets failed', e); }
}

function closeThemes(){
  const overlay = document.getElementById('themeOverlay');
  const popup = document.getElementById('themePopup');
  if(!overlay || !popup) return;
  overlay.setAttribute('aria-hidden','true'); overlay.style.display = 'none'; popup.setAttribute('aria-hidden','true');
  try{ const btn = document.getElementById('themeOpenBtn'); if(btn && typeof btn.focus === 'function') btn.focus(); }catch(e){}
}

// Bind theme UI controls
try{
  const themeOpen = document.getElementById('themeOpenBtn'); if(themeOpen) themeOpen.addEventListener('click', ()=>{ openThemes(); });
  const themeClose = document.getElementById('themeCloseBtn'); if(themeClose) themeClose.addEventListener('click', ()=>{ closeThemes(); });
  const themeGrid = document.getElementById('themeGrid'); if(themeGrid){ themeGrid.addEventListener('click', (ev)=>{ const btn = ev.target.closest && ev.target.closest('.theme-swatch'); if(!btn) return; if(btn.classList.contains('locked')){ try{ showToast('この砂の色はまだ解放されていません'); }catch(e){} return; } const id = btn.getAttribute('data-theme'); if(!id) return; if(id){ applyThemeId(id); closeThemes(); } }); }
  const bgThemeGrid = document.getElementById('bgThemeGrid'); if(bgThemeGrid){ bgThemeGrid.addEventListener('click', (ev)=>{ const btn = ev.target.closest && ev.target.closest('.theme-swatch'); if(!btn) return; if(btn.classList.contains('locked')){ try{ showToast('この背景はまだ解放されていません'); }catch(e){} return; } const id = btn.getAttribute('data-theme'); if(!id) return; if(id){ applyBgThemeId(id); closeThemes(); } }); }
}catch(e){/* ignore binding errors */}

// Apply saved theme on load (or default to 'sand')
try{
  const saved = localStorage.getItem(THEME_KEY);
  if(saved) applyThemeId(saved);
  else applyThemeId('sand');
  // Apply saved background theme if present
  try{ const savedBg = localStorage.getItem(BG_THEME_KEY); if(savedBg) applyBgThemeId(savedBg); }catch(e){}
  // Apply saved custom ring color if present
  try{ const savedRing = localStorage.getItem(RING_COLOR_KEY); if(savedRing) applyRingColor(savedRing); }catch(e){}
}catch(e){}
// After initial theme/load, ensure unlocks are processed and UI updated
try{ checkAndApplyNewUnlocks(); renderRingPresets(); updateRingPickerEnabledState(); }catch(e){}
// Also poll occasionally to detect level changes and apply unlocks (safe fallback)
try{ setInterval(checkAndApplyNewUnlocks, 2500); }catch(e){}


// Mobile-visible toast helper for environments without console (iPhone)
function showToast(msg, ms = 2000){
  try{
    let t = document.getElementById('mobileToast');
    if(!t){
      t = document.createElement('div');
      t.id = 'mobileToast';
      document.body.appendChild(t);
    }
    t.textContent = String(msg || '');
    t.classList.remove('toast-hide');
    t.classList.add('toast-show');
    // ensure visible
    t.style.display = 'block';
    clearTimeout(t._toastTimer);
    t._toastTimer = setTimeout(()=>{
      t.classList.remove('toast-show');
      t.classList.add('toast-hide');
      setTimeout(()=>{ try{ t.style.display = 'none'; }catch(e){} }, 220);
    }, ms || 2000);
    return t;
  }catch(e){ console.warn('showToast failed', e); }
}

// storage helpers are imported from src/storage.js

// Render today's tasks as a stacked log (newest on top)
function renderLogs(){
  const key = `tasks:${storage.keyDay()}`;
  const raw = localStorage.getItem(key) || "[]";
  let arr = [];
  try{ arr = JSON.parse(raw) || []; }catch(e){ arr = []; }
  const container = document.getElementById('logList');
  if(!container) return;
  if(arr.length === 0){ container.innerHTML = '<div class="log-empty">記録がありません</div>'; return; }

  // Render newest-first so the first rendered item is the newest log
  const items = arr.slice().reverse().map(t => {
    const startTs = t.start || t.createdAt || Date.now()/1000;
    const endTs = t.end || t.createdAt || t.start || Date.now()/1000;
    const dStart = new Date(startTs*1000);
    const dEnd = new Date(endTs*1000);
    const startTime = dStart.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const endTime = dEnd.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const layer = typeof t.layer === 'number' ? t.layer : Math.floor((t.elapsedSec||0)/UNIT_SEC);
    const meta = `${startTime} → ${endTime} · layer ${layer}`;

    const mood = (typeof t.mood !== 'undefined') ? `mood:${t.mood}` : '';
    const effort = (typeof t.effort !== 'undefined') ? `effort:${t.effort}` : '';
  const parts = [];
  if(t.taskname) parts.push(`タスク名: ${t.taskname}`);
  if(t.insight) parts.push(`気づき: ${t.insight}`);
  if(t.nexttask) parts.push(`次のタスク: ${t.nexttask}`);
  const comment = parts.join(' / ');
  // show full comment (no truncation) so user can read entire saved text
  const short = comment || '';
    return `
      <div class="log-item" data-task-id="${t.id}">
        <div class="log-meta"><div class="log-time">${meta}</div></div>
        <div class="log-meta"><div class="log-mood-effort">${[mood, effort].filter(x=>x).join(' ')}</div></div>
        <div class="log-comment">${short || '<span class="log-empty-text">(コメント無し)</span>'}</div>
        <div class="log-actions">
          <button class="log-edit" data-task-id="${t.id}">編集</button>
          <button class="log-delete" data-task-id="${t.id}">削除</button>
        </div>
      </div>`;
  });

  container.innerHTML = items.join('');
  // Event delegation for edit/delete to avoid relying on inline onclick handlers.
  try{
    if(!window._logDelegationBound){
      window._logDelegationBound = true;
      container.addEventListener('click', (ev)=>{
        const btn = ev.target.closest('button');
        if(!btn) return;
        if(btn.classList.contains('log-edit')){
          const id = btn.getAttribute('data-task-id');
          try{ editTask(id); }catch(e){ console.error('editTask handler failed', e); }
        } else if(btn.classList.contains('log-delete')){
          const id = btn.getAttribute('data-task-id');
          try{ window.deleteTask && window.deleteTask(id); }catch(e){ console.error('deleteTask handler failed', e); }
        }
      });
    }
  }catch(e){/* ignore delegation errors */}
}

// Re-render logs when storage module notifies about changes (emitted by src/storage.js).
// Use a small timeout to allow any modal close/reflow to complete before updating DOM.
try{
  window.addEventListener('sandstudy:tasks-changed', (ev)=>{
    try{ setTimeout(()=>{ try{ renderLogs(); // show newest-first, then ensure scroll/top visibility
      const c = document.getElementById('logList'); if(c) c.scrollTop = 0; }catch(e){} }, 20); }catch(e){}
  });
}catch(e){}

function clearInputs(){ ["taskname","insight","nexttask"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value = ""; }); document.getElementById("countdown").textContent = String(AUTO_SAVE_TIME); }

// Update an existing task by id. Returns true on success.
// updateTask/deleteTask are provided by src/storage.js; UI-specific confirmations and
// render calls remain in this file where appropriate.

function editTask(id){
  try{
  const key = `tasks:${storage.keyDay()}`;
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    const item = arr.find(x => x && x.id === id);
    if(!item) { showToast('編集対象が見つかりません'); return; }
    // populate modal inputs
    document.getElementById('taskname').value = item.taskname || '';
    document.getElementById('insight').value = item.insight || '';
    document.getElementById('nexttask').value = item.nexttask || '';
    try{ document.getElementById('mood').value = String(item.mood || 0); }catch(e){}
    try{ document.getElementById('effort').value = String(item.effort || 0); }catch(e){}
    // set editing flag and open modal
    editingTaskId = id;
    openEndModal(false);
  }catch(e){ console.error('editTask failed', e); showToast('編集開始に失敗しました'); }
}

// Expose to window for inline onclick handlers
try{
  window.editTask = editTask;
  // UI-facing delete: show confirmation, call storage.deleteTask, then refresh UI
  window.deleteTask = function(id){
    try{
      const ok = confirm('この記録を削除してもよいですか？\n操作は元に戻せません。');
      if(!ok) return false;
      const res = storage.deleteTask(id);
      try{ renderLogs(); }catch(e){}
      if(res) showToast('記録を削除しました');
      return res;
    }catch(e){ console.error('deleteTask (ui) failed', e); showToast('削除に失敗しました'); return false; }
  };
  // Expose raw updateTask for debugging but refresh logs after update
  window.updateTask = function(id, updates){
    try{
      const res = storage.updateTask(id, updates);
      try{ renderLogs(); }catch(e){}
      return res;
    }catch(e){ console.error('updateTask (ui) failed', e); return false; }
  };
}catch(e){}

// Expose for debugging and quick manual testing
window._bottle = {
  now,
  loadToday: storage.loadToday,
  saveToday: storage.saveToday,
  saveTask: storage.saveTask,
  applyLayer,
  // set today's layer (absolute) and re-render
  setLayerForDebug: (layer)=>{ try{ const k = `daily:${new Date().toISOString().slice(0,10)}`; const d = {date:new Date().toISOString().slice(0,10), layerTotal:layer, bottlesToday:Math.floor(layer/100), bottlesCum:storage.loadCumBase()+Math.floor(layer/100)}; localStorage.setItem(k, JSON.stringify(d)); today = d; render(); renderLogs(); }catch(e){} }
};

// --- Auto-save configuration ---
function getAutoSaveSeconds(){
  try{ const v = localStorage.getItem('autoSaveSeconds'); if(v === null) return AUTO_SAVE_TIME; return Number(v); }catch(e){ return AUTO_SAVE_TIME; }
}
function isAutoSaveOnNotification(){ try{ return localStorage.getItem('autoSaveOnNotification') === '1'; }catch(e){ return false; } }

function bindAutoSaveControls(){
  try{
    const sel = document.getElementById('autoSaveSelect');
    const chk = document.getElementById('autoSaveNotify');
    if(sel){ const current = String(getAutoSaveSeconds()); if([...sel.options].some(o=>o.value===current)) sel.value = current; else sel.value = '30'; sel.addEventListener('change', ()=>{ localStorage.setItem('autoSaveSeconds', String(sel.value)); }); }
    if(chk){ chk.checked = isAutoSaveOnNotification(); chk.addEventListener('change', ()=>{ localStorage.setItem('autoSaveOnNotification', chk.checked ? '1' : '0'); }); }
  }catch(e){/* ignore */}
}

// Debug UI bindings
function syncDebugDisplay(){
  const el = document.getElementById('debugLayerBadge');
  if(!el) return;
  el.textContent = `Layer: ${today.layerTotal || 0}`;
}

function changeLayer(delta){
  today.layerTotal = Math.max(0, (today.layerTotal||0) + delta);
  // keep bottlesToday and bottlesCum consistent for display
  today.bottlesToday = Math.floor((today.layerTotal||0) / BOTTLE_CAP);
  today.bottlesCum = storage.loadCumBase() + today.bottlesToday;
  storage.saveToday(today);
  render(); renderLogs(); syncDebugDisplay();
}

function changeBottles(delta){
  // adjust cumulative bottles (affects level)
  const base = storage.loadCumBase();
  const newCum = Math.max(0, base + (today.bottlesToday||0) + delta);
  localStorage.setItem('cum_base', String(newCum - (today.bottlesToday||0)) );
  today.bottlesCum = newCum;
  storage.saveToday(today);
  render(); renderLogs(); syncDebugDisplay();
}

document.addEventListener('DOMContentLoaded', ()=>{
  // Hide debug panel in non-dev environments to avoid showing internal controls in Prod
  try{
    if(!DEV){ const dbg = document.getElementById('debugPanel'); if(dbg) dbg.style.display = 'none'; }
  }catch(e){}
  // attach buttons if present
  const inc1 = document.getElementById('inc1'); if(inc1) inc1.addEventListener('click', ()=>changeLayer(1));
  const inc10 = document.getElementById('inc10'); if(inc10) inc10.addEventListener('click', ()=>changeLayer(10));
  const dec1 = document.getElementById('dec1'); if(dec1) dec1.addEventListener('click', ()=>changeLayer(-1));
  const set0 = document.getElementById('set0'); if(set0) set0.addEventListener('click', ()=>{ today.layerTotal = 0; storage.saveToday(today); render(); renderLogs(); syncDebugDisplay(); });
  const incBottle = document.getElementById('incBottle'); if(incBottle) incBottle.addEventListener('click', ()=>changeBottles(1));
  const decBottle = document.getElementById('decBottle'); if(decBottle) decBottle.addEventListener('click', ()=>changeBottles(-1));
  const setLayerBtn = document.getElementById('setLayerBtn'); if(setLayerBtn){ setLayerBtn.addEventListener('click', ()=>{ const v = Number(document.getElementById('setLayerInput').value||0); today.layerTotal = Math.max(0, Math.floor(v)); today.bottlesToday = Math.floor(today.layerTotal / BOTTLE_CAP); today.bottlesCum = storage.loadCumBase() + today.bottlesToday; storage.saveToday(today); render(); renderLogs(); syncDebugDisplay(); }); }
  // initial sync
  syncDebugDisplay();
  // bind auto-save UI controls
  try{ bindAutoSaveControls(); }catch(e){/* ignore */}
  // target minutes input and upgrade button
  const tInp = document.getElementById('targetMinutesInput');
  if(tInp){
    // initialize from stored/default
    tInp.value = String(TARGET_MINUTES);
    tInp.addEventListener('change', ()=>{ setTargetMinutes(Number(tInp.value||TARGET_MINUTES)); });
    tInp.addEventListener('input', ()=>{ /* live update not necessary */ });
  }
  const upgradeBtn = document.getElementById('upgradeBtn');
  if(upgradeBtn){
    upgradeBtn.addEventListener('click', ()=>{
      if(isProUser()){
        if(confirm('Pro を無効にしますか？')){ setProUser(false); alert('Pro をオフにしました'); }
      } else {
        showUpgradePrompt();
      }
    });
  }

  // --- Service Worker update detection and user-driven activation ---
  try{
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then(reg => {
        // When a new SW is found installing
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          newSW.addEventListener('statechange', () => {
                if(newSW.state === 'installed'){
                  // If there's an active controller, this is an update. Show update banner instead of confirm.
                  if(navigator.serviceWorker.controller){
                    try{
                      const banner = document.getElementById('updateBanner');
                      const msgEl = banner && banner.querySelector('.msg');
                      const nowBtn = banner && document.getElementById('updateNowBtn');
                      const laterBtn = banner && document.getElementById('updateLaterBtn');
                      if(banner){
                        if(msgEl) msgEl.textContent = '新しいバージョンが利用可能です。更新するとページがリロードされます。';
                        banner.style.display = 'flex';
                        // show manual check/update control when update is available
                        try{ const chk = document.getElementById('checkUpdateBtn'); if(chk) chk.style.display = 'inline-block'; }catch(_){ }
                        // cleanup previous handlers
                        try{ nowBtn && nowBtn.replaceWith(nowBtn.cloneNode(true)); }catch(_){}
                        try{ laterBtn && laterBtn.replaceWith(laterBtn.cloneNode(true)); }catch(_){}
                        const nb = document.getElementById('updateNowBtn');
                        const lb = document.getElementById('updateLaterBtn');
                        if(nb){ nb.addEventListener('click', ()=>{
                          // Send SKIP_WAITING to the waiting worker via registration if possible
                          navigator.serviceWorker.getRegistration().then(reg => {
                            if(reg && reg.waiting){ reg.waiting.postMessage({ type: 'SKIP_WAITING' }); }
                          }).catch(()=>{/* ignore */});
                          // hide banner while update proceeds
                          banner.style.display = 'none';
                        }); }
                        if(lb){ lb.addEventListener('click', ()=>{ banner.style.display = 'none'; }); }
                      }
                    }catch(e){/* ignore */}
                  }
                }
          });
        });
      }).catch(()=>{/* noop */});

      // If registration already has a waiting worker (e.g., deployed while client was closed), show update UI
      try{
        if(reg && reg.waiting){
          const banner = document.getElementById('updateBanner');
          const msgEl = banner && banner.querySelector('.msg');
          if(banner){ if(msgEl) msgEl.textContent = '新しいバージョンが利用可能です。更新するとページがリロードされます。'; banner.style.display = 'flex'; }
          try{ const chk = document.getElementById('checkUpdateBtn'); if(chk) chk.style.display = 'inline-block'; }catch(_){ }
        }
      }catch(e){/* ignore */}

      // When the active controller changes (new SW took control), reload to load latest assets
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        try{ window.location.reload(); }catch(e){/* ignore */}
      });
    }
  }catch(e){/* ignore SW update wiring errors */}
  // ensure target UI reflects current state
  updateTargetUI();
  try{ updateControlButtons(); }catch(e){}

  // Reset session button (main controls) with confirmation
  const resetSessionBtn = document.getElementById('resetSessionBtn');
  if(resetSessionBtn){
    resetSessionBtn.addEventListener('click', ()=>{
      // Show embedded confirmation UI
      const embed = document.getElementById('resetConfirmOverlay');
      if(!embed) {
        // fallback to browser confirm
        if(!confirm('リセットしますか？')) return;
        performReset();
        return;
      }
  // show overlay as flex so CSS centering rules apply
  embed.style.display = 'flex';
  embed.setAttribute('aria-hidden', 'false');
      // focus Yes button for quick keyboard confirm
      const yes = document.getElementById('resetConfirmYes'); if(yes) yes.focus();
    });
  }

  // embedded confirm handlers
  const resetYes = document.getElementById('resetConfirmYes');
  const resetNo = document.getElementById('resetConfirmNo');
  function hideResetConfirm(){
    const e = document.getElementById('resetConfirmOverlay');
    if(!e) return;
    // If focus is inside the overlay, move focus out first to avoid aria-hidden being blocked
    try{
      const active = document.activeElement;
      if(active && e.contains(active)){
        try{ active.blur(); }catch(_){/* ignore */}
        const fallback = document.getElementById('startBtn') || document.body;
        try{ if(fallback && typeof fallback.focus === 'function') fallback.focus(); }catch(_){/* ignore */}
      }
    }catch(_){/* ignore */}
    e.setAttribute('aria-hidden','true');
    e.style.display = 'none';
  }
  function performReset(){
    stopTimerInterval();
    stopCountdown();
    sessionStart = null;
    isRunning = false;
    elapsedStopped = 0;
    const timerEl = document.getElementById('timerDisplay'); if(timerEl) timerEl.textContent = '00:00';
    updateCountdownUI(TARGET_SECONDS, 0);
    hideOvertimeAlert();
    hideResetConfirm();
    try{ updateTargetUI(); }catch(e){}
    try{ updateControlButtons(); }catch(e){}
  }
  if(resetYes){ resetYes.addEventListener('click', ()=>{ performReset(); }); }
  if(resetNo){ resetNo.addEventListener('click', ()=>{ hideResetConfirm(); }); }
  // close overlay when clicking outside the popup box
  const resetOverlay = document.getElementById('resetConfirmOverlay');
  if(resetOverlay){
    resetOverlay.addEventListener('click', (ev)=>{
      if(ev.target === resetOverlay){ hideResetConfirm(); }
    });
  }
  // allow Esc key to dismiss embedded confirm
  document.addEventListener('keydown', (ev)=>{
    if(ev.key === 'Escape'){
      const e = document.getElementById('resetConfirmOverlay');
      if(e && e.style.display !== 'none'){ hideResetConfirm(); }
    }
  });
  // enable SE (development) button
  const enableSEBtn = document.getElementById('enableSEBtn'); if(enableSEBtn) enableSEBtn.addEventListener('click', ()=>{ enableSound(); enableSEBtn.disabled = true; enableSEBtn.textContent = 'SE enabled'; });
  // sound test button (for mobile: user gesture to unlock audio then play 3x0.5s beeps)
  const soundTestBtn = document.getElementById('soundTestBtn');
  if(soundTestBtn){
    soundTestBtn.addEventListener('click', ()=>{
      try{ enableSound(); }catch(e){}
      // small delay to let audio context resume
      setTimeout(()=>{ try{ playSETriple0_5s(); }catch(e){} }, 150);
    });
  }
  // notification test button
  const notifyTestBtn = document.getElementById('notifyTestBtn');
  if(notifyTestBtn){
    notifyTestBtn.addEventListener('click', ()=>{
      try{
        if(!('Notification' in window)){
          alert('このブラウザは通知に対応していません');
          return;
        }
        Notification.requestPermission().then(p => {
          if(p === 'granted'){
            try{
              const n = new Notification('Sand Study（テスト）', { body: '通知テスト — クリックで記録ダイアログを開きます', tag:'sandstudy-test' });
              n.onclick = ()=>{ try{ window.focus && window.focus(); }catch(e){}; try{ openEndModal(false); }catch(e){}; try{ n.close(); }catch(e){} };
            }catch(e){ console.warn('notify test failed', e); }
          } else if(p === 'denied'){
            alert('通知が拒否されています。ブラウザのサイト設定から通知を許可してください。');
          } else {
            // default
            alert('通知の許可が必要です。もう一度「通知テスト」をタップして許可してください。');
          }
        });
      }catch(e){ console.warn('notifyTest click failed', e); }
    });
  }
  // dismiss button for overtime alert
  const dismiss = document.getElementById('dismissAlertBtn'); if(dismiss) dismiss.addEventListener('click', ()=>{ hideOvertimeAlert(); });
    // Push subscribe UI hooks
    const pushSubscribeBtn = document.getElementById('pushSubscribeBtn');
    const pushUnsubscribeBtn = document.getElementById('pushUnsubscribeBtn');
    if(pushSubscribeBtn){ pushSubscribeBtn.addEventListener('click', async ()=>{
      try{
        if(!('serviceWorker' in navigator)) { showToast('Service Worker が必要です'); return; }
        if(!('PushManager' in window)) {
          // Provide actionable guidance for iOS users where Push may require PWA/Home Screen or newer iOS
          const help = `このブラウザは Push をサポートしていません。

主な対処方法:
- iOS をご利用の場合: iOS 16.4+ が必要で、サイトを「ホーム画面に追加」して PWA として開く必要がある場合があります。
- ブラウザがプライベートモードではないことを確認してください。
- サイトは HTTPS で開いてください（ngrok 等の https を使用）。

やり方: Safari の共有メニュー→「ホーム画面に追加」。その後ホーム画面からアプリとして開いて再試行してください。`;
          alert(help);
          return;
        }
        // Try to fetch VAPID public key from server; if not available, prompt user
        let vapidPublicKey = null;
        try{
          const r = await fetch('/api/vapidPublicKey');
          if(r.ok){ vapidPublicKey = await r.text(); }
        }catch(e){ /* ignore */ }
        if(!vapidPublicKey){ vapidPublicKey = prompt('VAPID 公開鍵を入力してください（Base64 URL safe）'); }
        if(!vapidPublicKey) { showToast('VAPID 公開鍵が必要です'); return; }
        await subscribeForPush(vapidPublicKey.trim());
      }catch(e){ console.error('push subscribe failed', e); showToast('Push 登録に失敗しました'); }
    }); }
    if(pushUnsubscribeBtn){ pushUnsubscribeBtn.addEventListener('click', async ()=>{
      try{ await unsubscribePush(); }catch(e){ console.error('unsubscribe failed', e); showToast('Push 解除に失敗しました'); }
    }); }

    // Also attach handlers to the always-visible main push buttons (if present)
    const pushSubscribeBtnMain = document.getElementById('pushSubscribeBtnMain');
    const pushUnsubscribeBtnMain = document.getElementById('pushUnsubscribeBtnMain');
    if(pushSubscribeBtnMain){ pushSubscribeBtnMain.addEventListener('click', async ()=>{
      try{
        if(!('serviceWorker' in navigator)) { showToast('Service Worker が必要です'); return; }
        if(!('PushManager' in window)) {
          const help = `このブラウザは Push をサポートしていません。\n\n主な対処方法:\n- iOS をご利用の場合: iOS 16.4+ が必要で、サイトを「ホーム画面に追加」して PWA として開く必要がある場合があります。\n- ブラウザがプライベートモードではないことを確認してください。\n- サイトは HTTPS で開いてください（ngrok 等の https を使用）。\n\nやり方: Safari の共有メニュー→「ホーム画面に追加」。その後ホーム画面からアプリとして開いて再試行してください。`;
          alert(help);
          return;
        }
        let vapidPublicKey = null;
        try{
          const r = await fetch('/api/vapidPublicKey');
          if(r.ok){ vapidPublicKey = await r.text(); }
        }catch(e){ /* ignore */ }
        if(!vapidPublicKey){ vapidPublicKey = prompt('VAPID 公開鍵を入力してください（Base64 URL safe）'); }
        if(!vapidPublicKey) { showToast('VAPID 公開鍵が必要です'); return; }
        await subscribeForPush(vapidPublicKey.trim());
      }catch(e){ console.error('push subscribe (main) failed', e); showToast('Push 登録に失敗しました'); }
    }); }
    if(pushUnsubscribeBtnMain){ pushUnsubscribeBtnMain.addEventListener('click', async ()=>{ try{ await unsubscribePush(); }catch(e){ console.error('unsubscribe failed (main)', e); showToast('Push 解除に失敗しました'); } }); }

  // iOS help dialog
  try{
    const iosHelpBtn = document.getElementById('iosHelpBtn');
    const iosHelpClose = document.getElementById('iosHelpClose');
    const iosDialog = document.getElementById('iosHelpDialog');
    if(iosHelpBtn){ iosHelpBtn.addEventListener('click', ()=>{ try{ if(iosDialog && typeof iosDialog.showModal === 'function'){ iosDialog.showModal(); } else { alert('iOS 手順: Safari の共有メニュー→ホーム画面に追加 を行ってください。'); } }catch(e){ alert('iOS 手順: Safari の共有メニュー→ホーム画面に追加 を行ってください。'); } }); }
    if(iosHelpClose){ iosHelpClose.addEventListener('click', ()=>{ try{ if(iosDialog && typeof iosDialog.close === 'function'){ iosDialog.close(); } else { /* hide fallback */ iosDialog.style.display = 'none'; } }catch(e){ try{ iosDialog.style.display = 'none'; }catch(_){}} }); }
  }catch(e){/* ignore */}

    // populate vapid key & subscription status on load
    (async ()=>{
      try{
        const kv = document.getElementById('vapidKey');
        const status = document.getElementById('pushStatus');
        const endpointEl = document.getElementById('pushEndpoint');
        // fetch public key if server provides it
        try{
          const r = await fetch('/vapidPublicKey');
          if(r.ok){ const pk = await r.text(); if(kv) kv.textContent = pk; }
        }catch(e){}
        // diagnostic: is running as PWA/standalone?
        const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (window.navigator.standalone === true);
        if(status) status.textContent = isStandalone ? '起動モード: PWA' : '起動モード: ブラウザ';
        // show basic feature availability
        try{
          const supportNotes = [];
          supportNotes.push(('serviceWorker' in navigator) ? 'SW:OK' : 'SW:×');
          supportNotes.push(('PushManager' in window) ? 'PushAPI:OK' : 'PushAPI:×');
          if(kv && kv.textContent) supportNotes.push('VAPIDあり');
          if(status) status.textContent += ' · ' + supportNotes.join(' · ');
        }catch(e){}

        // check existing subscription if possible
        if('serviceWorker' in navigator && 'PushManager' in window){
          try{
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if(sub){
              if(status) status.textContent = (status.textContent||'') + ' · 登録済み';
              if(endpointEl) endpointEl.textContent = sub.endpoint || JSON.stringify(sub);
            } else {
              if(status) status.textContent = (status.textContent||'') + ' · 未登録';
            }
          }catch(e){ if(status) status.textContent = (status.textContent||'') + ' · サブ確認エラー'; }
        } else {
          // if PushManager missing, clearly inform user
          if(!('PushManager' in window) && status) status.textContent = (status.textContent||'') + ' · このモードでは Push 非対応';
        }
      }catch(e){/* ignore */}
    })();
});

// --- Development-only sound effect using Web Audio API ---
let SOUND_ENABLED = false; // default off
let audioCtx = null;
function enableSound(){
  if(SOUND_ENABLED) return;
  try{
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // resume context on user gesture
    audioCtx.resume().then(()=>{
      SOUND_ENABLED = true;
      try{ window.SOUND_ENABLED = true; window.audioCtx = audioCtx; }catch(_){/* ignore */}
      // optional small test beep
      playSE();
    }).catch(()=>{ /* ignore */ });
  }catch(e){
    console.warn('WebAudio not supported', e);
  }
}
    
  // Settings button: provide data wipe (local tasks/daily + remote Firestore doc)
  try{
    const settingsBtn = document.getElementById('topBtnSettings');
    if(settingsBtn){
      settingsBtn.addEventListener('click', async (ev)=>{
        ev.preventDefault();
        const ok = confirm('注意: データを完全に削除します。ローカルの記録と（サインイン中の場合）リモートの履歴も削除されます。よろしいですか？');
        if(!ok) return;
        try{
          // Stop any running session and timers
          try{ performReset(); }catch(e){}
          // remove app data keys: tasks:, daily:, cum_base, last_date, favTargets, pushSubscription
          const delKeys = [];
          for(let i=0;i<localStorage.length;i++){ const k = localStorage.key(i); if(!k) continue; if(k.startsWith('tasks:') || k.startsWith('daily:') ) delKeys.push(k); }
          ['cum_base','last_date', 'pushSubscription', 'favTargets:v1'].forEach(k=>{ if(localStorage.getItem(k)!==null) delKeys.push(k); });
          delKeys.forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
          // If signed in, also delete remote Firestore doc
          try{
            if(window.firebase && firebase.auth && firebase.auth().currentUser && firebase.firestore){
              const uid = firebase.auth().currentUser.uid;
              try{ await firebase.firestore().collection('users').doc(uid).delete(); console.debug('Settings: remote user doc deleted for', uid); }catch(e){ console.warn('Settings: failed to delete remote doc', e); }
            }
          }catch(e){ console.warn('Settings: remote delete check failed', e); }
          // Re-render UI and notify
          try{ renderAll(); }catch(e){}
          alert('データを削除しました');
          // Optionally sign out user so they start fresh
          try{ if(window.firebase && firebase.auth && firebase.auth().currentUser){ await firebase.auth().signOut(); } }catch(e){ /* ignore */ }
          // reload to ensure state is consistent
          window.location.reload();
        }catch(e){ console.error('wipe failed', e); alert('データ削除に失敗しました。Console を確認してください。'); }
      });
    }
  }catch(e){ console.warn('settings hook failed', e); }

// Play a short sound effect. durationMs is optional (default 600ms).
function playSE(durationMs = 600){
  if(!SOUND_ENABLED || !audioCtx) return;
  try{
    // ensure audio context is resumed
    if(audioCtx.state === 'suspended') try{ audioCtx.resume(); }catch(_){}

    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880; // A5 beep
    // start with a very small gain to avoid clicks
    g.gain.value = 0.00001;
    o.connect(g);
    g.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    const dur = Math.max(50, Number(durationMs) || 600) / 1000; // seconds, min 50ms

    // quick attack
    g.gain.setValueAtTime(0.00001, now);
    g.gain.linearRampToValueAtTime(0.18, now + Math.min(0.05, dur * 0.2));
    o.start(now);
    // sustain for most of duration, then release
    const releaseStart = now + Math.max(0.05, dur * 0.6);
    g.gain.linearRampToValueAtTime(0.00001, releaseStart + Math.min(0.15, dur * 0.4));
    // stop oscillator shortly after release completes
    o.stop(now + dur + 0.02);
  }catch(e){ console.warn('playSE failed', e); }
}

// Expose helpers to the global scope for easier console testing (module -> window)
try{
  window.enableSound = enableSound;
  window.playSE = playSE;
  window.notifyTargetReached = notifyTargetReached;
  window.getAudioState = () => (typeof audioCtx !== 'undefined' && audioCtx ? audioCtx.state : 'no audioCtx');
  // Play a sequence of beeps: count times, each durationMs long, with gapMs between them
  function playSESequence(count = 3, durationMs = 1000, gapMs = 200){
    const total = Math.max(0, Number(count) || 0);
    const dur = Math.max(50, Number(durationMs) || 1000);
    const gap = Math.max(0, Number(gapMs) || 200);
    for(let i=0;i<total;i++){
      setTimeout(()=>{ try{ playSE(dur); }catch(e){} }, i * (dur + gap));
    }
  }
  window.playSESequence = playSESequence;
  // convenience: 3 beeps of 1s
  window.playSETriple1s = ()=> playSESequence(3, 1000, 200);
  // convenience: 3 beeps of 0.5s
  window.playSETriple0_5s = ()=> playSESequence(3, 500, 150);
}catch(e){/* ignore in strict environments */}

// Listen for messages from the Service Worker (e.g., notification clicks)
if('serviceWorker' in navigator){
  try{
    navigator.serviceWorker.addEventListener('message', (ev)=>{
          try{
            const msg = ev && ev.data;
            if(msg && msg.type === 'notification-click'){
                  // Only open the end modal automatically when a session exists or the timer has run.
                  // If there's no active/previous session, avoid opening the end modal to prevent
                  // showing a completion dialog for a task that never started.
                  try{
                    if(sessionStart || isRunning || (typeof elapsedStopped === 'number' && elapsedStopped > 0)){
                      // Open the end modal but DO NOT start the auto-save countdown.
                      // This prevents an immediate save when the user taps a notification.
                      try{ openEndModal(false); }catch(e){/* ignore */}
                    } else {
                      // No session: just focus the app and show a helpful toast instead
                      try{ window.focus && window.focus(); }catch(_){/* ignore */}
                      try{ showToast('タイマーは開始されていません — まず開始してください'); }catch(_){/* ignore */}
                    }
                  }catch(e){/* ignore */}
            }

                  // Manual update check button: allow user to check for a new SW and activate it immediately
                  try{
                    const checkBtn = document.getElementById('checkUpdateBtn');
                    if(checkBtn){
                      checkBtn.addEventListener('click', ()=>{
                        if(!('serviceWorker' in navigator)){ showToast('Service Worker 未対応'); return; }
                        navigator.serviceWorker.getRegistration().then(reg => {
                          if(!reg){ showToast('Service Worker が未登録です'); return; }
                          // If there's already a waiting worker, request it to skip waiting
                          if(reg.waiting){
                            try{ reg.waiting.postMessage({ type: 'SKIP_WAITING' }); }catch(e){/* ignore */}
                            return;
                          }
                          // Otherwise, ask the registration to check for updates
                          reg.update().then(()=>{
                            if(reg.waiting){ try{ reg.waiting.postMessage({ type: 'SKIP_WAITING' }); }catch(e){} } else { showToast('既に最新です'); }
                          }).catch(()=>{ showToast('更新確認に失敗しました'); });
                        }).catch(()=>{ showToast('更新確認中にエラーが発生しました'); });
                      });
                    }
                  }catch(e){/* ignore */}
          }catch(e){/* ignore */}
    });
  }catch(e){/* ignore */}
}
