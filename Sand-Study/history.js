// history.js - aggregate localStorage data and render heatmaps using Canvas API

// Responsive canvas sizing - グリッドを正方形に
function getResponsiveCanvasSize(){
  const containerWidth = Math.min(window.innerWidth - 40, 3000); // 最大3000px、左右20pxマージン
  const isMobile = window.innerWidth < 768;
  
  // グリッドは24時間×5段階 = 24:5の比率
  // 正方形セルにするため、パディングを考慮して高さを計算
  const scale = containerWidth / 1800;
  const yAxisLabelSpace = Math.floor(90 * scale);
  const visualPadding = Math.floor(50 * scale);
  const paddingH = (yAxisLabelSpace + visualPadding) * 2; // 左右合計（対称）
  const paddingV = Math.floor((120 + 120) * scale); // 上下合計
  const gridWidth = containerWidth - paddingH;
  const gridHeight = gridWidth * 5 / 24; // 正方形セルにするための高さ
  const totalHeight = Math.floor(gridHeight + paddingV);
  
  return { width: containerWidth, height: totalHeight };
}

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
  
  // Set responsive canvas width first, then compute paddings/grid from width
  const size = getResponsiveCanvasSize();
  canvas.width = size.width;

  // Compute scale/paddings based on width
  const scale = canvas.width / 1800;
  const isMobile = canvas.width < 768;
  const yAxisLabelSpace = Math.floor(90 * scale);
  const visualPadding = Math.floor(50 * scale);
  
  // 対称的なパディングでグリッドを真ん中に配置
  // 左側にY軸ラベルスペースがあるので、右側も同じだけ空ける
  const symmetricPadding = yAxisLabelSpace + visualPadding;
  const paddingLeft = symmetricPadding;
  const paddingRight = symmetricPadding;
  const paddingTop = Math.floor(100 * scale);
  const paddingBottom = Math.floor(100 * scale);

  // Determine score values: Mood uses -2..2, Effort uses 1..5
  const scoreValues = (canvasId === 'moodChart') ? [-2, -1, 0, 1, 2] : [1,2,3,4,5];
  const numScores = scoreValues.length;
  // Grid width determines grid height so cells are square (24 x numScores)
  const gridWidth = canvas.width - paddingLeft - paddingRight;
  const gridHeight = Math.floor(gridWidth * numScores / 24);
  const cellWidth = gridWidth / 24;
  const cellHeight = gridHeight / numScores;
  const totalHeight = Math.max(120, gridHeight + paddingTop + paddingBottom);
  canvas.height = totalHeight;
  
  // グリッド開始位置を計算（canvas の中心にグリッドの中心を合わせる）
  const gridCenterX = canvas.width / 2;
  const gridStartX = gridCenterX - gridWidth / 2;

  console.log(`[${canvasId}] Canvas size set to:`, canvas.width, 'x', canvas.height, '| Window width:', window.innerWidth, 'paddings L/R/T/B', paddingLeft, paddingRight, paddingTop, paddingBottom);

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
  
  // Responsive padding based on canvas size - グリッドを視覚的に中央配置
  
  // Use paddings and grid sizes computed earlier
  console.log(`[${canvasId}] Padding - Left: ${paddingLeft}, Right: ${paddingRight}, Grid starts at: ${gridStartX}, Canvas width: ${canvas.width}`);

  // Draw grid background for visual debugging (optional)
  ctx.fillStyle = '#f9fafb';
  ctx.fillRect(gridStartX, paddingTop, gridWidth, gridHeight);
  
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
  
  // Responsive font sizes - より大きく見やすく
  const fontSize = {
    title: Math.floor(36 * scale),      // 28 → 36
    cellText: Math.floor(28 * scale),   // 20 → 28
    axisLabel: Math.floor(24 * scale),  // 18 → 24
    yAxisLabel: Math.floor(28 * scale), // 20 → 28
    axisTitle: Math.floor(30 * scale)   // 22 → 30
  };
  
  // Draw title (削除)
  // ctx.fillStyle = '#1f2937';
  // ctx.font = `bold ${fontSize.title}px sans-serif`;
  // ctx.textAlign = 'center';
  // ctx.fillText(label + ' ヒートマップ', canvas.width / 2, paddingTop * 0.6);
  
  // Draw heatmap cells
  for(let hour = 0; hour < 24; hour++){
    const scores = hourlyFreq[hour];
    
    for(let si = 0; si < numScores; si++){
      const scoreVal = scoreValues[si];
      const count = scores[scoreVal] || 0;
      const deviation = count > 0 && stdDev > 0 ? 50 + 10 * (count - mean) / stdDev : (count > 0 ? 50 : 0);
      const clampedDev = Math.max(0, Math.min(100, deviation));
      
      const x = gridStartX + hour * cellWidth;
      // invert Y axis: highest score at top
      const y = paddingTop + (numScores - 1 - si) * cellHeight;
      
      ctx.fillStyle = getColor(clampedDev);
      ctx.fillRect(x, y, cellWidth - 1, cellHeight - 1);
      
      // Draw border
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
      ctx.lineWidth = Math.max(0.5, scale);
      ctx.strokeRect(x, y, cellWidth - 1, cellHeight - 1);
      
      // Draw count text if significant
      const minCellWidth = isMobile ? 20 : 30;
      if(count > 0 && cellWidth > minCellWidth){
        ctx.fillStyle = clampedDev > 60 ? 'white' : '#374151';
        ctx.font = `bold ${fontSize.cellText}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(count.toString(), x + cellWidth / 2, y + cellHeight / 2);
      }
    }
  }
  
  // Draw X-axis labels (hours)
  ctx.fillStyle = '#6b7280';
  ctx.font = `${fontSize.axisLabel}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for(let h = 0; h <= 23; h += 2){
    const x = gridStartX + h * cellWidth + cellWidth / 2;
    ctx.fillText(`${h}時`, x, canvas.height - paddingBottom + paddingBottom * 0.2);
  }
  
  // Draw Y-axis labels (scores) - canvasの左端基準で配置
  ctx.font = `${fontSize.yAxisLabel}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  // Y-axis labels: use scoreValues (top to bottom)
  for(let si = 0; si < numScores; si++){
    const labelVal = scoreValues[numScores - 1 - si]; // top label is highest score
    const y = paddingTop + si * cellHeight + cellHeight / 2;
    ctx.fillText(`${labelVal}点`, Math.max(0, paddingLeft - visualPadding * 0.4), y);
  }
  
  // Draw axis titles
  ctx.font = `bold ${fontSize.axisTitle}px sans-serif`;
  ctx.fillStyle = '#374151';
  ctx.textAlign = 'center';
  ctx.fillText('時刻', canvas.width / 2, canvas.height - paddingBottom * 0.3);
  
  // Y-axis title (rotated) - canvasの左端に配置
  ctx.save();
  ctx.translate(24, canvas.height / 2);
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
  // Group entries by day (YYYY-MM-DD) and produce a CSV with a date header for each day.
  // Individual rows will only include times (HH:MM) so the per-row date is hidden.
  const byDay = {};
  for(const t of entries){
    const ts = (t.start || t.createdAt || Date.now()/1000) * 1000;
    const day = new Date(ts).toISOString().slice(0,10);
    if(!byDay[day]) byDay[day] = [];
    byDay[day].push(t);
  }

  const days = Object.keys(byDay).sort();
  const rows = [];
  for(const day of days){
    rows.push([`Date: ${day}`]);
    // header for this day's logs (time only for start/end)
    rows.push(['start_time','end_time','mood','effort','taskname','insight','nexttask']);
    // sort entries by start time within the day
    const list = (byDay[day] || []).slice().sort((a,b)=> ((a.start||a.createdAt)||0) - ((b.start||b.createdAt)||0));
    for(const t of list){
      const start = new Date((t.start||t.createdAt)*1000);
      const end = new Date((t.end||t.createdAt||t.start)*1000);
      const startTime = start.toISOString().slice(11,16);
      const endTime = end.toISOString().slice(11,16);
      rows.push([startTime, endTime, (''+ (typeof t.mood !== 'undefined' ? t.mood : '')), (''+ (typeof t.effort !== 'undefined' ? t.effort : '')), (t.taskname||''), (t.insight||''), (t.nexttask||'')]);
    }
    // blank separator row
    rows.push([]);
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
  const m = parseInt(document.getElementById('debugM')?.value || '0');
  const e = parseInt(document.getElementById('debugE')?.value || '3');
    const layer = parseInt(document.getElementById('debugLayer')?.value || '1');
    
  if(!dateStr){ alert('日付を入力してください'); return; }
  // Valid ranges: M = -2..2, E = 1..5
  if(m < -2 || m > 2 || e < 1 || e > 5){ alert('M値は-2〜2、E値は1〜5の範囲で入力してください'); return; }
    
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
    
    // Also update daily summary so bottle list shows the new entry
    try{
      const dailyKey = keyDailyForDay(dateStr);
      const rawDaily = localStorage.getItem(dailyKey) || '{}';
      let dailyObj = {};
      try{ dailyObj = JSON.parse(rawDaily) || {}; }catch(e){ dailyObj = {}; }
      // Add layer amount, then recompute bottlesToday from layerTotal to avoid double-counting
      const prevLayer = Number(dailyObj.layerTotal || 0);
      const addLayer = Number(layer || 0);
      const newLayerTotal = prevLayer + addLayer;
      dailyObj.layerTotal = newLayerTotal;
      // BOTTLE_CAP is defined in app.js (shared); compute today's bottles as floor(layerTotal / BOTTLE_CAP)
      try{
        dailyObj.bottlesToday = Math.floor(newLayerTotal / BOTTLE_CAP);
      }catch(e){
        // fallback if BOTTLE_CAP not in scope
        dailyObj.bottlesToday = Math.floor(newLayerTotal / 100);
      }
      dailyObj.lastUpdated = new Date().toISOString();
      localStorage.setItem(dailyKey, JSON.stringify(dailyObj));
    }catch(err){ console.warn('Failed to update daily summary', err); }
    
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
  
  // 初期描画を実行
  renderAll();
  
  // Add resize listener for responsive canvas
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // Re-render charts if they exist
      const moodCanvas = document.getElementById('moodChart');
      const effortCanvas = document.getElementById('effortChart');
      if(moodCanvas && moodCanvas.width > 0){
        renderAll();
      }
    }, 250); // Debounce to avoid too many re-renders
  });
});
