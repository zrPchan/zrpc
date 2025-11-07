// history.js - aggregate localStorage data and render heatmaps using Canvas API

function keyTasksForDay(day){ return `tasks:${day}`; }
function keyDailyForDay(day){ return `daily:${day}`; }

function parseDateInput(id){ const el=document.getElementById(id); if(!el || !el.value) return null; return el.value; }

function dateRange(start, end){
  const s = new Date(start);
  const e = new Date(end);
  const days = [];
  for(let d=new Date(s); d<=e; d.setDate(d.getDate()+1)) days.push(new Date(d).toISOString().slice(0,10));
  return days;
}

function loadTasksForRange(start, end){
  const days = dateRange(start,end);
  let all = [];
  for(const day of days){
    const raw = localStorage.getItem(keyTasksForDay(day)) || '[]';
    try{ const arr = JSON.parse(raw) || []; all = all.concat(arr); }catch(e){/*ignore*/}
  }
  return all;
}

function aggregateHourly(entries){
  // returns arrays length 24: avg mood, avg effort, counts, plus heatmap frequency data
  const sumsMood = Array(24).fill(0);
  const sumsEff = Array(24).fill(0);
  const counts = Array(24).fill(0);
  
  // For heatmap: count frequency of each score per day-hour
  const dailyHourlyMoodFreq = {}; // { "2025-11-08:14": {1:2, 2:0, 3:5, 4:1, 5:3} }
  const dailyHourlyEffFreq = {};
  
  for(const t of entries){
    const ts = (t.start || t.createdAt || Date.now()/1000) * 1000;
    const date = new Date(ts);
    const h = date.getHours();
    const day = date.toISOString().slice(0,10);
    const key = `${day}:${h}`;
    
    if(typeof t.mood === 'number' || !isNaN(Number(t.mood))){ 
      const moodVal = Math.round(Number(t.mood));
      sumsMood[h] += Number(t.mood);
      if(!dailyHourlyMoodFreq[key]) dailyHourlyMoodFreq[key] = {};
      dailyHourlyMoodFreq[key][moodVal] = (dailyHourlyMoodFreq[key][moodVal] || 0) + 1;
    }
    if(typeof t.effort === 'number' || !isNaN(Number(t.effort))){ 
      const effVal = Math.round(Number(t.effort));
      sumsEff[h] += Number(t.effort);
      if(!dailyHourlyEffFreq[key]) dailyHourlyEffFreq[key] = {};
      dailyHourlyEffFreq[key][effVal] = (dailyHourlyEffFreq[key][effVal] || 0) + 1;
    }
    counts[h] += 1;
  }
  const avgMood = sumsMood.map((s,i)=> counts[i]? s/counts[i] : null);
  const avgEff = sumsEff.map((s,i)=> counts[i]? s/counts[i] : null);
  return {avgMood, avgEff, counts, dailyHourlyMoodFreq, dailyHourlyEffFreq};
}

function renderChart(canvasId, label, freqData, startDate, endDate){
  const canvas = document.getElementById(canvasId);
  if(!canvas){ console.warn('Canvas not found', canvasId); return; }
  
  const ctx = canvas.getContext('2d');
  
  // Validate freqData
  if(!freqData || typeof freqData !== 'object'){
    console.error('Invalid freqData:', freqData);
    return;
  }
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Aggregate all days into hourly frequency map (overlapping all dates)
  const hourlyFreq = Array(24).fill(null).map(() => ({})); // [{1:0, 2:0, 3:0, 4:0, 5:0}, ...]
  
  Object.entries(freqData).forEach(([key, scores]) => {
    const hour = parseInt(key.split(':')[1]);
    if(hour >= 0 && hour < 24 && scores && typeof scores === 'object'){
      Object.entries(scores).forEach(([score, count]) => {
        const s = parseInt(score);
        if(!hourlyFreq[hour][s]) hourlyFreq[hour][s] = 0;
        hourlyFreq[hour][s] += count;
      });
    }
  });
  
  // Calculate statistics for deviation score
  const allCounts = [];
  for(let hour = 0; hour < 24; hour++){
    const scores = hourlyFreq[hour];
    Object.values(scores).forEach(count => allCounts.push(count));
  }
  
  const mean = allCounts.length > 0 ? allCounts.reduce((a,b)=>a+b,0) / allCounts.length : 0;
  const variance = allCounts.length > 0 ? allCounts.reduce((a,b)=>a+Math.pow(b-mean,2),0) / allCounts.length : 1;
  const stdDev = Math.sqrt(variance);
  
  // Canvas dimensions and layout
  const padding = 60;
  const gridWidth = canvas.width - padding * 2;
  const gridHeight = canvas.height - padding * 2;
  const cellWidth = gridWidth / 24;
  const cellHeight = gridHeight / 5;
  
  // Color scale based on deviation score
  const getColor = (deviation) => {
    if(deviation === 0) return 'rgba(240, 240, 240, 0.3)'; // no data
    // Gradient: blue (low) -> green -> yellow -> orange -> red (high)
    const colors = [
      { dev: 0, rgb: [59, 130, 246] },    // blue
      { dev: 30, rgb: [34, 197, 94] },    // green
      { dev: 50, rgb: [250, 204, 21] },   // yellow
      { dev: 70, rgb: [251, 146, 60] },   // orange
      { dev: 100, rgb: [239, 68, 68] }    // red
    ];
    
    for(let i = 0; i < colors.length - 1; i++){
      if(deviation >= colors[i].dev && deviation <= colors[i+1].dev){
        const t = (deviation - colors[i].dev) / (colors[i+1].dev - colors[i].dev);
        const r = Math.round(colors[i].rgb[0] + t * (colors[i+1].rgb[0] - colors[i].rgb[0]));
        const g = Math.round(colors[i].rgb[1] + t * (colors[i+1].rgb[1] - colors[i].rgb[1]));
        const b = Math.round(colors[i].rgb[2] + t * (colors[i+1].rgb[2] - colors[i].rgb[2]));
        return `rgba(${r}, ${g}, ${b}, 0.85)`;
      }
    }
    return 'rgba(239, 68, 68, 0.85)';
  };
  
  // Draw title
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label + ' ヒートマップ', canvas.width / 2, 30);
  
  // Draw heatmap cells
  for(let hour = 0; hour < 24; hour++){
    const scores = hourlyFreq[hour];
    
    for(let scoreVal = 1; scoreVal <= 5; scoreVal++){
      const count = scores[scoreVal] || 0;
      const deviation = count > 0 && stdDev > 0 ? 50 + 10 * (count - mean) / stdDev : (count > 0 ? 50 : 0);
      const clampedDev = Math.max(0, Math.min(100, deviation));
      
      const x = padding + hour * cellWidth;
      const y = padding + (5 - scoreVal) * cellHeight; // invert Y axis (5 at top, 1 at bottom)
      
      ctx.fillStyle = getColor(clampedDev);
      ctx.fillRect(x, y, cellWidth - 1, cellHeight - 1);
      
      // Draw border
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, cellWidth - 1, cellHeight - 1);
      
      // Draw count text if significant
      if(count > 0 && cellWidth > 20){
        ctx.fillStyle = clampedDev > 60 ? 'white' : '#374151';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(count.toString(), x + cellWidth / 2, y + cellHeight / 2);
      }
    }
  }
  
  // Draw X-axis labels (hours)
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for(let h = 0; h <= 23; h += 2){
    const x = padding + h * cellWidth + cellWidth / 2;
    ctx.fillText(`${h}時`, x, canvas.height - padding + 10);
  }
  
  // Draw Y-axis labels (scores)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for(let s = 1; s <= 5; s++){
    const y = padding + (5 - s) * cellHeight + cellHeight / 2;
    ctx.fillText(`${s}点`, padding - 10, y);
  }
  
  // Draw axis titles
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#374151';
  ctx.textAlign = 'center';
  ctx.fillText('時刻', canvas.width / 2, canvas.height - 15);
  
  ctx.save();
  ctx.translate(15, canvas.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('評価値', 0, 0);
  ctx.restore();
}

function renderBottleList(start,end){
  const days = dateRange(start,end);
  const out = [];
  for(const day of days){
    const raw = localStorage.getItem(keyDailyForDay(day));
    if(!raw) continue;
    try{ const d = JSON.parse(raw); out.push({day, bottlesToday: d.bottlesToday || 0, layerTotal: d.layerTotal || 0}); }catch(e){}
  }
  const container = document.getElementById('bottleList');
  if(!container) return;
  if(out.length===0){ container.innerHTML = '<div class="log-empty">データがありません</div>'; return; }
  container.innerHTML = out.map(o=> `<div class="log-item"><div><strong>${o.day}</strong></div><div>bottles: ${o.bottlesToday} · layer: ${o.layerTotal}</div></div>`).join('');
}

function exportCsv(entries){
  const rows = [['start','end','mood','effort','taskname','insight','nexttask']];
  for(const t of entries){
    const start = new Date((t.start||t.createdAt)*1000).toISOString();
    const end = new Date((t.end||t.createdAt||t.start)*1000).toISOString();
    rows.push([start,end,(''+t.mood),(''+t.effort), (t.taskname||''), (t.insight||''),(t.nexttask||'')]);
  }
  const csv = rows.map(r=> r.map(c=> '"'+(''+c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'sandstudy_export.csv'; a.click(); URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', ()=>{
  const today = new Date().toISOString().slice(0,10);
  const startEl = document.getElementById('startDate');
  const endEl = document.getElementById('endDate');
  if(startEl) startEl.value = today;
  if(endEl) endEl.value = today;
  
  // デバッグ用ログ追加機能
  const debugDateEl = document.getElementById('debugDate');
  if(debugDateEl) debugDateEl.value = today;
  
  // Render function - reusable for both manual draw and auto-update
  function renderAll(){
    const s = parseDateInput('startDate'); 
    const e = parseDateInput('endDate');
    if(!s||!e){ 
      console.warn('Start or end date not set');
      return; 
    }
    const entries = loadTasksForRange(s,e);
    if(window && window.__DEV__){ console.log('loaded entries count', entries.length); }
    const status = document.getElementById('historyStatus');
    if(status) status.textContent = `読み込んだエントリ: ${entries.length}`;
    
    if(entries.length === 0){
      if(status) status.textContent = '読み込んだエントリ: 0（データがありません）';
      // clear canvases if present
      const moodCanvas = document.getElementById('moodChart');
      const effortCanvas = document.getElementById('effortChart');
      if(moodCanvas){ const ctx = moodCanvas.getContext('2d'); ctx.clearRect(0, 0, moodCanvas.width, moodCanvas.height); }
      if(effortCanvas){ const ctx = effortCanvas.getContext('2d'); ctx.clearRect(0, 0, effortCanvas.width, effortCanvas.height); }
      const container = document.getElementById('bottleList'); if(container) container.innerHTML = '<div class="log-empty">データがありません</div>';
      // still attach export (no-op)
      document.getElementById('exportCsv').onclick = ()=> exportCsv(entries);
      return;
    }
    const agg = aggregateHourly(entries);
    renderChart('moodChart','Mood 頻度', agg.dailyHourlyMoodFreq, s, e);
    renderChart('effortChart','Effort 頻度', agg.dailyHourlyEffFreq, s, e);
    renderBottleList(s,e);
    // attach csv export
    document.getElementById('exportCsv').onclick = ()=> exportCsv(entries);
  }
  
  // デバッグ用ログ追加機能
  document.getElementById('addDebugLog')?.addEventListener('click', () => {
    const dateStr = document.getElementById('debugDate')?.value;
    const timeStr = document.getElementById('debugTime')?.value || '12:00';
    const m = parseInt(document.getElementById('debugM')?.value || '3');
    const e = parseInt(document.getElementById('debugE')?.value || '3');
    const layer = parseInt(document.getElementById('debugLayer')?.value || '1');
    
    if(!dateStr){ alert('日付を入力してください'); return; }
    if(m < 1 || m > 5 || e < 1 || e > 5){ alert('M値とE値は1-5の範囲で入力してください'); return; }
    
    // Create timestamp from date + time
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    const timestamp = new Date(year, month - 1, day, hour, minute, 0).getTime() / 1000;
    
    // Create debug log entry
    const debugEntry = {
      start: timestamp,
      createdAt: timestamp,
      mood: m,
      effort: e,
      layer: layer,
      debug: true // mark as debug entry
    };
    
    // Save to localStorage
    const tasksKey = keyTasksForDay(dateStr);
    const existingRaw = localStorage.getItem(tasksKey) || '[]';
    let existing = [];
    try{ existing = JSON.parse(existingRaw) || []; }catch(err){ console.error('Parse error:', err); }
    existing.push(debugEntry);
    localStorage.setItem(tasksKey, JSON.stringify(existing));
    
    // Update status
    const statusEl = document.getElementById('debugStatus');
    if(statusEl){
      statusEl.textContent = `✅ 追加完了: ${dateStr} ${timeStr} M=${m} E=${e} Layer=${layer}`;
      statusEl.style.color = '#22c55e';
      // Don't auto-clear the message - let user see the result
    }
    
    console.log('Debug log added:', debugEntry);
    
    // Auto-refresh the display
    renderAll();
  });

  document.getElementById('drawBtn').addEventListener('click', renderAll);
});
