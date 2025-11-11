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

// return local YYYY-MM-DD (use local timezone to avoid UTC offset issues)
function localDateString(d = new Date()){ 
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

function localTimeString(d = new Date()){
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${hh}:${mm}`;
}

// Single-hue color gradient: t in [0,1] -> color on the current theme hue
function hslToRgb(h, s, l){
  // h,s,l in [0,1]
  let r, g, b;
  if(s === 0){ r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (p, q, t) => {
      if(t < 0) t += 1;
      if(t > 1) t -= 1;
      if(t < 1/6) return p + (q - p) * 6 * t;
      if(t < 1/2) return q;
      if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Shared color gradient using single theme hue. Returns an rgb() string or null for t==0.
function colorFromPercent(t){
  if(typeof t !== 'number' || !isFinite(t)) t = 0;
  t = Math.max(0, Math.min(1, t));
  if(t === 0) return null;
  let hue = 212; // default
  try{
    const cs = getComputedStyle(document.documentElement);
    const hv = cs.getPropertyValue('--theme-hue');
    if(hv) hue = Number(hv.trim()) || hue;
  }catch(e){ /* ignore */ }
  // saturation and lightness mapping: lightness 92% (very pale) -> 30% (dark) as t goes 0->1
  const sat = 0.85;
  const lightHigh = 0.92;
  const lightLow = 0.30;
  const l = lightHigh + (lightLow - lightHigh) * t;
  const rgb = hslToRgb((hue % 360) / 360, sat, l);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// 判断: rgb/rgba の色文字列が渡されたら相対輝度を計算して暗色か判定
function colorIsDark(colorStr){
  if(!colorStr || typeof colorStr !== 'string') return false;
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if(!m) return false;
  const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
  // sRGB -> linear
  const srgb = [r,g,b].map(v => v/255).map(c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return L < 0.5; // 閾値: 0.5 未満を暗色とみなす
}

function parseDateInput(id){ const el=document.getElementById(id); if(!el || !el.value) return null; return el.value; }

function dateRange(start, end){
  const s = new Date(start);
  const e = new Date(end);
  const days = [];
  for(let d=new Date(s); d<=e; d.setDate(d.getDate()+1)) days.push(localDateString(new Date(d)));
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
  const day = localDateString(date);
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
    // Map deviation (0..100) to 0..1 and use unified gradient
    const t = Math.max(0, Math.min(1, deviation / 100));
    const col = colorFromPercent(t);
    return col ? col.replace('rgb', 'rgba').replace(')', ', 0.85)') : 'rgba(240,240,240,0.3)';
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
      
  const cellColor = getColor(clampedDev);
  ctx.fillStyle = cellColor;
  ctx.fillRect(x, y, cellWidth - 1, cellHeight - 1);
      
      // Draw border
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
      ctx.lineWidth = Math.max(0.5, scale);
      ctx.strokeRect(x, y, cellWidth - 1, cellHeight - 1);
      
      // Draw count text if significant
      const minCellWidth = isMobile ? 20 : 30;
      if(count > 0 && cellWidth > minCellWidth){
        const textColor = colorIsDark(cellColor) ? 'white' : '#374151';
        ctx.fillStyle = textColor;
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

// Compute per-day layer increases between consecutive days in range
function computeDailyLayerDeltas(startDate, endDate){
  const days = dateRange(startDate, endDate);
  const deltas = {}; // { '2025-11-09': 3, ... }
  let prevLayer = 0;
  for(const day of days){
    const raw = localStorage.getItem(keyDailyForDay(day));
    let obj = null;
    try{ obj = JSON.parse(raw || '{}') || {}; }catch(e){ obj = {}; }
    const layer = Number(obj.layerTotal || 0);
    const delta = Math.max(0, layer - prevLayer);
    deltas[day] = delta;
    prevLayer = layer;
  }
  return deltas;
}

// Render calendar heatmap: rows = weekdays (Mon..Sun), cols = weeks from start to end
// renderCalendarHeatmap(canvasId, startDate, endDate, deltas, weeksArg)
// If weeksArg is provided, use that many weeks with the rightmost column ending at endDate's week.
function renderCalendarHeatmap(canvasId, startDate, endDate, deltas, weeksArg){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  // Determine week grid: if weeksArg provided, show that many weeks ending at endDate's week
  const end = new Date(endDate);
  const endDow = end.getDay();
  const endMonday = new Date(end);
  const offsetToMondayEnd = (endDow === 0) ? -6 : (1 - endDow);
  endMonday.setDate(end.getDate() + offsetToMondayEnd);
  const weeks = Number.isFinite(Number(weeksArg)) && weeksArg > 0 ? Number(weeksArg) : (function(){
    // default: compute weeks from startDate to endDate
    const start = new Date(startDate);
    const startDow = start.getDay();
    const startMonday = new Date(start);
    const offsetToMonday = (startDow === 0) ? -6 : (1 - startDow);
    startMonday.setDate(start.getDate() + offsetToMonday);
    const diffDays = Math.ceil((endMonday.getTime() - startMonday.getTime()) / (24*3600*1000)) + 1;
    return Math.max(1, Math.ceil(diffDays / 7));
  })();

  // leftmost monday (weeks-1 weeks before endMonday)
  const monday = new Date(endMonday);
  monday.setDate(monday.getDate() - (weeks - 1) * 7);

  // layout
  // compute cell size to fit 52 weeks across typical widths; min/max bounds keep cells readable
  const targetWidth = Math.min(window.innerWidth - 160, 1800);
  const yLabelsWidth = 48;
  const gutter = 4;
  // compute cell size after constants are defined
  const cellSize = Math.max(8, Math.min(28, Math.floor((targetWidth - yLabelsWidth - 24 - weeks * gutter) / Math.max(1, weeks))));
  const width = yLabelsWidth + weeks * (cellSize + gutter) + 24;
  const height = (7 * (cellSize + gutter)) + 40;
  canvas.width = Math.min(width, 1800);
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width, canvas.height);

  // weekday labels (Monday..Sunday in Japanese)
  const weekdays = ['月','火','水','木','金','土','日'];
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#374151';
  for(let i=0;i<7;i++){
    const y = 20 + i * (cellSize + gutter) + cellSize/2;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(weekdays[i], yLabelsWidth - 8, y);
  }

  // prepare color scale: map delta (0..maxDelta) to color
  const values = Object.values(deltas || {});
  const max = Math.max(1, ...values);
  const getColor = (v)=>{
    if(!v || v <= 0) return '#f3f4f6';
    // use unified gradient; map v/max -> 0..1
    const t = Math.min(1, (v || 0) / Math.max(1, max));
    const col = colorFromPercent(t);
    return col || '#f3f4f6';
  };

  // draw cells week by week
  for(let w=0; w<weeks; w++){
    for(let d=0; d<7; d++){
      const colX = yLabelsWidth + w * (cellSize + gutter) + 8;
      const colY = 12 + d * (cellSize + gutter);
      // compute date for this cell
      const cellDate = new Date(monday);
      cellDate.setDate(monday.getDate() + w*7 + d);
      const dayKey = localDateString(cellDate);
      // only draw if within requested range
      if(new Date(dayKey) < new Date(startDate) || new Date(dayKey) > new Date(endDate)){
        // draw inactive cell
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(colX, colY, cellSize, cellSize);
        ctx.strokeStyle = 'rgba(0,0,0,0.04)'; ctx.strokeRect(colX, colY, cellSize, cellSize);
        continue;
      }
      const v = deltas[dayKey] || 0;
      const cellColor = getColor(v);
      ctx.fillStyle = cellColor;
      ctx.fillRect(colX, colY, cellSize, cellSize);
      ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.strokeRect(colX, colY, cellSize, cellSize);
      // small number label if value > 0 and enough space
      if(v > 0 && cellSize > 18){
        const textColor = colorIsDark(cellColor) ? '#fff' : '#111827';
        ctx.fillStyle = textColor;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(v), colX + cellSize/2, colY + cellSize/2);
      }
    }
  }
  // draw month labels under the weeks (show when month changes)
  try{
    let prevMonth = null;
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#374151';
    for(let w=0; w<weeks; w++){
      const weekStart = new Date(monday);
      weekStart.setDate(monday.getDate() + w*7);
      const month = weekStart.getMonth() + 1;
      if(w === 0 || month !== prevMonth){
        const x = yLabelsWidth + w * (cellSize + gutter) + 8 + cellSize/2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${month}月`, x, canvas.height - 18);
        prevMonth = month;
      }
    }
  }catch(err){ /* ignore label errors */ }
  // footer: week labels for first day of each week (YYYY-MM-DD) optional
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
  // Read selection from a page-level select (#exportFormat). Default to csv.
  try{
    const sel = document.getElementById('exportFormat');
    const choice = sel ? (sel.value || 'csv') : 'csv';
    if(String(choice).toLowerCase() === 'md'){
      exportMarkdown(entries);
    } else {
      exportCsvRaw(entries);
    }
  }catch(e){
    exportCsvRaw(entries);
  }
}

function exportCsvRaw(entries){
  // previous CSV grouping behavior (date headers + start/end times)
  const byDay = {};
  for(const t of entries){
  const ts = (t.start || t.createdAt || Date.now()/1000) * 1000;
  const day = localDateString(new Date(ts));
    if(!byDay[day]) byDay[day] = [];
    byDay[day].push(t);
  }

  const days = Object.keys(byDay).sort();
  const rows = [];
  for(const day of days){
    rows.push([`Date: ${day}`]);
    rows.push(['start_time','end_time','mood','effort','taskname','insight','nexttask']);
    const list = (byDay[day] || []).slice().sort((a,b)=> ((a.start||a.createdAt)||0) - ((b.start||b.createdAt)||0));
    for(const t of list){
      const start = new Date((t.start||t.createdAt)*1000);
      const end = new Date((t.end||t.createdAt||t.start)*1000);
  const startTime = localTimeString(start);
  const endTime = localTimeString(end);
      rows.push([startTime, endTime, (''+ (typeof t.mood !== 'undefined' ? t.mood : '')), (''+ (typeof t.effort !== 'undefined' ? t.effort : '')), (t.taskname||''), (t.insight||''), (t.nexttask||'')]);
    }
    rows.push([]);
  }
  const csv = rows.map(r=> r.map(c=> '"'+(''+c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'sandstudy_export.csv'; a.click(); URL.revokeObjectURL(url);
}

function exportMarkdown(entries){
  // Group entries by day and output Markdown suitable for Obsidian daily notes
  const byDay = {};
  for(const t of entries){
    const ts = (t.start || t.createdAt || Date.now()/1000) * 1000;
    const day = localDateString(new Date(ts));
    if(!byDay[day]) byDay[day] = [];
    byDay[day].push(t);
  }
  const days = Object.keys(byDay).sort();
  const lines = [];
  for(const day of days){
    lines.push(`# ${day}`);
    lines.push('');
  // Obsidian 用テンプレート（日本語ヘッダ）
  lines.push('| 開始 | 終了 | 気分 | 努力感 | タスク名 | 気づき | 次のタスク |');
  // 開始/終了は右寄せ、気分/努力感は中央、残りは左寄せ
  lines.push('|---:|---:|:---:|:---:|:---|:---|:---|');
    const list = (byDay[day] || []).slice().sort((a,b)=> ((a.start||a.createdAt)||0) - ((b.start||b.createdAt)||0));
    for(const t of list){
      const start = new Date((t.start||t.createdAt)*1000);
      const end = new Date((t.end||t.createdAt||t.start)*1000);
  const startTime = localTimeString(start);
  const endTime = localTimeString(end);
  const mood = (typeof t.mood !== 'undefined') ? String(t.mood) : '';
  const effort = (typeof t.effort !== 'undefined') ? String(t.effort) : '';
  const task = (t.taskname||'').replace(/\|/g,'\|');
  const insight = (t.insight||'').replace(/\|/g,'\|');
  const next = (t.nexttask||'').replace(/\|/g,'\|');
  lines.push(`| ${startTime} | ${endTime} | ${mood} | ${effort} | ${task} | ${insight} | ${next} |`);
    }
    lines.push('');
  }
  const md = lines.join('\n');
  const blob = new Blob([md],{type:'text/markdown;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'sandstudy_export.md'; a.click(); URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', ()=>{
  const today = localDateString(new Date());
  const startEl = document.getElementById('startDate');
  const endEl = document.getElementById('endDate');
  // デフォルト: 空の場合は今日を設定する（既に値がある場合は上書きしない）
  if(startEl && !startEl.value) startEl.value = today;
  if(endEl && !endEl.value) endEl.value = today;

  // 開始日を変更したとき、終了日が未設定または開始日より前なら終了日を同期する
  if(startEl){
    startEl.addEventListener('change', () => {
      try{
        const s = startEl.value;
        if(!s) return;
        if(endEl && (!endEl.value || new Date(endEl.value) < new Date(s))){
          endEl.value = s;
        }
      }catch(e){ /* ignore */ }
    });
  }
  
  // デバッグ用ログ追加機能
  const debugDateEl = document.getElementById('debugDate');
  (function bindPresetButtons(){
    if(!startEl || !endEl) return;
    const presets = [
      {id:'p-today', fn:()=>({s: today, e: today})},
      {id:'p-yesterday', fn:()=>{ const d=new Date(); d.setDate(d.getDate()-1); const s=localDateString(d); return {s,e:s}; }},
      {id:'p-7', fn:()=>{ const e=new Date(); const s=new Date(); s.setDate(s.getDate()-6); return {s: localDateString(s), e: localDateString(e)} }},
      {id:'p-week', fn:()=>{ const now=new Date(); const dow=now.getDay(); const s=new Date(now); s.setDate(s.getDate() - dow + (dow===0? -6:1)); const e=new Date(s); e.setDate(s.getDate()+6); return {s: localDateString(s), e: localDateString(e)} }},
      {id:'p-month', fn:()=>{ const now=new Date(); const s=new Date(now.getFullYear(), now.getMonth(), 1); const e=new Date(now.getFullYear(), now.getMonth()+1, 0); return {s: localDateString(s), e: localDateString(e)} }},
    ];
    presets.forEach(p=>{
      const btn = document.getElementById(p.id);
      if(btn){
        btn.addEventListener('click', ()=>{
          try{
            const r = p.fn();
            startEl.value = r.s; endEl.value = r.e || r.s;
            setTimeout(()=>{ if(typeof renderAll === 'function') renderAll(); }, 0);
          }catch(err){ console.warn('preset error', err); }
        });
      }
    });
  })();

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
  // calendar heatmap for layer increases
  const deltas = computeDailyLayerDeltas(s,e);
  renderCalendarHeatmap('calendarHeatmap', s, e, deltas);
    renderBottleList(s,e);
    // attach export handler to existing export button; exportCsv reads #exportFormat select
    const exportBtn = document.getElementById('exportCsv');
    if(exportBtn){ exportBtn.onclick = ()=> exportCsv(entries); }
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
  if(m < -2 || m > 2 || e < 1 || e > 5){ alert('Moodは-2〜2、Effortは1〜5の範囲で入力してください'); return; }
    
    // Create timestamp from date + time
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    const timestamp = new Date(year, month - 1, day, hour, minute, 0).getTime() / 1000;
    
    // Create debug log entry (ensure it has an id so sync/merge can dedupe reliably)
    const genId = (() => { try{ return (crypto && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : null; }catch(e){ return null; } })();
    // Create debug log entry
    const debugEntry = {
      id: genId || ('id-' + Date.now() + '-' + Math.floor(Math.random()*100000)),
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

  // -----------------------------
  // Firebase sync (placeholder) - login required for upload/download
  // -----------------------------
  // If Firebase SDK is loaded via CDN, this block will initialize; otherwise controls remain disabled.
  const btnSignIn = document.getElementById('btnSignIn');
  const btnSignOut = document.getElementById('btnSignOut');
  const syncStatus = document.getElementById('syncStatus');

  function setAuthUI(signedIn, uid){
    // Minimal UI control for history page: only show sign-out button if present and update status
    if(signedIn){
      btnSignIn && (btnSignIn.style.display = 'none');
      btnSignOut && (btnSignOut.style.display = '');
      syncStatus && (syncStatus.textContent = '接続: ' + (uid || '認証済み'));
    } else {
      btnSignIn && (btnSignIn.style.display = '');
      btnSignOut && (btnSignOut.style.display = 'none');
      syncStatus && (syncStatus.textContent = '未接続');
    }
  }

  // Utility: collect all tasks/daily into object
  function exportAllLocalStorageAsObject(){
    const out = { tasks: {}, daily: {} };
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      try{
        if(k && k.startsWith('tasks:')) out.tasks[k] = JSON.parse(localStorage.getItem(k) || '[]');
        if(k && k.startsWith('daily:')) out.daily[k] = JSON.parse(localStorage.getItem(k) || '{}');
      }catch(e){ /* ignore malformed entries */ }
    }
    return out;
  }

  // Import object into localStorage (merge option supported)
  function importAllFromJsonObj(obj, opts = {merge:false}){
    if(!obj) return;
    if(!opts.merge){
      // overwrite all provided keys
      Object.entries(obj.tasks || {}).forEach(([k,v]) => {
        try{
          const arr = (v||[]).map(item => {
            if(!item) return item;
            try{ if(!item.id){ if(typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') item.id = crypto.randomUUID(); } }catch(e){}
            if(!item.id) item.id = 'id-' + (item.createdAt || Date.now()) + '-' + Math.floor(Math.random()*100000);
            return item;
          });
          localStorage.setItem(k, JSON.stringify(arr));
        }catch(e){ console.warn('Failed writing tasks overwrite for', k, e); }
      });
      Object.entries(obj.daily || {}).forEach(([k,v]) => localStorage.setItem(k, JSON.stringify(v)));
      return;
    }

    // Helper: dedupe an array of task-like objects.
    // Uses `id` if present, otherwise falls back to createdAt + JSON fingerprint.
    function dedupeTasksArray(arr){
      const seen = new Map();
      (arr || []).forEach(item => {
        try{
          if(!item) return;
          const key = item.id || (String(item.createdAt||'') + '|' + (item.text || item.mood || JSON.stringify(item)));
          const prev = seen.get(key);
          if(!prev){
            seen.set(key, item);
          } else {
            // If both have an updatedAt-like field, keep the newer one
            const prevTs = Number(prev.updatedAt || prev.modifiedAt || prev.createdAt || 0);
            const curTs = Number(item.updatedAt || item.modifiedAt || item.createdAt || 0);
            if(curTs > prevTs) seen.set(key, item);
          }
        }catch(e){ /* ignore faulty item */ }
      });
      const out = Array.from(seen.values());
      // sort by createdAt if present
      out.sort((a,b)=> (Number(a.createdAt||0) - Number(b.createdAt||0)));
      return out;
    }

    // Merge tasks: concat, dedupe, sort
    Object.entries(obj.tasks || {}).forEach(([k,v]) => {
      try{
        const existing = JSON.parse(localStorage.getItem(k) || '[]');
        let merged = dedupeTasksArray(existing.concat(v));
        // Ensure every task has an id so future merges/dedupe work reliably
        merged = merged.map(item => {
          try{
            if(!item) return item;
            if(!item.id){
              try{ if(typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') item.id = crypto.randomUUID();
              }catch(e){ /* ignore */ }
              if(!item.id) item.id = 'id-' + (item.createdAt || Date.now()) + '-' + Math.floor(Math.random()*100000);
            }
          }catch(e){}
          return item;
        });
        localStorage.setItem(k, JSON.stringify(merged));
      }catch(e){ console.warn('Failed merging tasks for', k, e); }
    });

    // Merge daily: shallow merge but prefer numeric fields conservatively
    Object.entries(obj.daily || {}).forEach(([k,v]) => {
      try{
        const existing = JSON.parse(localStorage.getItem(k) || '{}');
        const merged = Object.assign({}, existing || {}, v || {});
        // For numeric cumulative fields (layerTotal etc) prefer the larger value to avoid double-counting
        try{
          const exLayer = Number(existing.layerTotal || 0);
          const vLayer = Number(v.layerTotal || 0);
          merged.layerTotal = Math.max(exLayer, vLayer);
        }catch(e){}
        // Recompute bottlesToday from layerTotal when possible so it's consistent
        try{
          const cap = (typeof BOTTLE_CAP !== 'undefined') ? Number(BOTTLE_CAP) : 100;
          merged.bottlesToday = Math.floor((Number(merged.layerTotal || 0)) / (cap || 100));
        }catch(e){}
        // lastUpdated -> take the latest ISO string if present
        try{
          const exLu = existing.lastUpdated || '';
          const vLu = v.lastUpdated || '';
          merged.lastUpdated = (exLu && vLu) ? (exLu > vLu ? exLu : vLu) : (vLu || exLu || new Date().toISOString());
        }catch(e){ merged.lastUpdated = v.lastUpdated || existing.lastUpdated || new Date().toISOString(); }

        localStorage.setItem(k, JSON.stringify(merged));
      }catch(e){ console.warn('Failed merging daily for', k, e); }
    });
  }

  // Firebase helper functions (require firebase global)
  let firebaseInited = false;

  // small loader used when history page is opened directly (it doesn't include main.js)
  function loadScript(src){
    return new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = ()=>resolve(s);
      s.onerror = (e)=>reject(new Error('Failed to load '+src));
      document.head.appendChild(s);
    });
  }

  async function initFirebaseIfAvailable(){
    if(firebaseInited) return;
    console.debug('history.js: initFirebaseIfAvailable called', { time: new Date().toISOString(), firebaseDefined: typeof window.firebase !== 'undefined', FIREBASE_CONFIG: !!(window.FIREBASE_CONFIG || window.__FIREBASE_CONFIG__) });
    try{
      // If firebase-init (shared initializer) is present, wait briefly for it to initialize
      // This avoids double-loading the compat SDKs (which causes a console warning).
      async function waitForFirebaseInit(timeoutMs = 1500){
        const start = Date.now();
        while(Date.now() - start < timeoutMs){
          if(window.__FIREBASE_INITIALIZED__ || typeof window.firebase !== 'undefined') return true;
          await new Promise(res => setTimeout(res, 50));
        }
        return false;
      }

      const detected = await waitForFirebaseInit(1500);
      if(detected){
        console.debug('history.js: detected existing firebase or firebase-init; skipping immediate dynamic SDK load');
        // try to ensure config is loaded too
        try{ if(!window.FIREBASE_CONFIG && !window.__FIREBASE_CONFIG__) await loadScript('/assets/js/firebase-config.js'); }catch(_){}
      } else {
        // If firebase not present, try to load compat SDKs and optional local config
        if(typeof window.firebase === 'undefined'){
          try{
            await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
            await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js');
            await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js');
            // try to load local config script which should set window.FIREBASE_CONFIG
            try{ await loadScript('/assets/js/firebase-config.js'); }catch(_){ /* ignore */ }
          }catch(e){
            console.warn('Failed to load Firebase SDKs on history page', e);
            setAuthUI(false);
            return;
          }
        }
      }

      // Placeholder config: replace with your Firebase project config or provide /assets/js/firebase-config.js
      const firebaseConfig = window.FIREBASE_CONFIG || window.__FIREBASE_CONFIG__ || {
        apiKey: "<API_KEY>",
        authDomain: "<PROJECT_ID>.firebaseapp.com",
        projectId: "<PROJECT_ID>",
      };
      if(!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      const auth = firebase.auth();
      const db = firebase.firestore();

          console.debug('history.js: Firebase present. apps.length=', (firebase.apps && firebase.apps.length) || 0, ' auth exists=', !!firebase.auth, 'firestore available=', !!(firebase && firebase.firestore));
          console.debug('history.js: auth.currentUser before attach=', (()=>{ try{ const u = firebase && firebase.auth && firebase.auth().currentUser; return u ? {uid:u.uid, email:u.email} : null;}catch(e){return 'err';}})());

          auth.onAuthStateChanged(user => {
                console.debug('history.js auth.onAuthStateChanged (early):', { time: new Date().toISOString(), user: user ? { uid: user.uid, email: user.email } : null, authCurrentUser: (firebase && firebase.auth && firebase.auth().currentUser) ? { uid: firebase.auth().currentUser.uid } : null, firebaseApps: (firebase.apps&&firebase.apps.length) });
            if(user){
              setAuthUI(true, user.uid);
            } else {
              setAuthUI(false);
            }
          });

      // Note: sign-in UI removed from history page; top-page modal handles sign-in.

      // Automatic sync: detect local changes and push, and subscribe to remote changes to merge
      let unsubscribeRemote = null;
      let lastLocalSnapshot = JSON.stringify(exportAllLocalStorageAsObject());
      let lastLocalWrite = 0; // ms since epoch
      let autoUploadTimer = null;
      const AUTO_UPLOAD_DEBOUNCE = 2000; // ms

      function scheduleAutoUpload(){
        if(autoUploadTimer) clearTimeout(autoUploadTimer);
        autoUploadTimer = setTimeout(async ()=>{
          const user = auth.currentUser;
          if(!user) return;
          try{
            const payload = exportAllLocalStorageAsObject();
            await db.collection('users').doc(user.uid).set({ data: payload, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            lastLocalWrite = Date.now();
            lastLocalSnapshot = JSON.stringify(payload);
            syncStatus && (syncStatus.textContent = '自動アップロード: ' + new Date().toLocaleTimeString());
          }catch(e){ console.warn('自動アップロード失敗', e); syncStatus && (syncStatus.textContent = 'アップロード失敗'); }
        }, AUTO_UPLOAD_DEBOUNCE);
      }

      // Poll localStorage snapshot every 3s to detect changes (works across all code paths without invasive hooks)
      const localPollInterval = setInterval(()=>{
        try{
          const snap = JSON.stringify(exportAllLocalStorageAsObject());
          if(snap !== lastLocalSnapshot){
            lastLocalSnapshot = snap;
            scheduleAutoUpload();
          }
        }catch(e){ /* ignore */ }
      }, 3000);

      // Manual sync helpers (triggered by user via UI)
      async function doUploadNow(){
        const user = auth.currentUser;
        if(!user){ syncStatus && (syncStatus.textContent = '未認証: サインインしてください'); return; }
        try{
          syncStatus && (syncStatus.textContent = 'アップロード中...');
          const payload = exportAllLocalStorageAsObject();
          try{ console.debug('doUploadNow: user=', user && user.uid, 'payloadKeys=', Object.keys(payload).length, 'tasksKeys=', Object.keys(payload.tasks||{}).length, 'dailyKeys=', Object.keys(payload.daily||{}).length); }catch(_){ }
          await db.collection('users').doc(user.uid).set({ data: payload, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          lastLocalWrite = Date.now();
          lastLocalSnapshot = JSON.stringify(payload);
          syncStatus && (syncStatus.textContent = 'アップロード完了: ' + new Date().toLocaleTimeString());
          console.debug('doUploadNow: upload finished for user=', user && user.uid);
        }catch(e){ console.warn('手動アップロード失敗', e); syncStatus && (syncStatus.textContent = 'アップロード失敗'); }
      }

      async function doDownloadNow(){
        const user = auth.currentUser;
        if(!user){ syncStatus && (syncStatus.textContent = '未認証: サインインしてください'); return; }
        try{
          syncStatus && (syncStatus.textContent = 'ダウンロード中...');
          const doc = await db.collection('users').doc(user.uid).get();
          console.debug('doDownloadNow: fetched doc exists=', !!(doc && doc.exists));
          if(doc && doc.exists){
            const full = doc.data();
            console.debug('doDownloadNow: remote doc data keys=', Object.keys(full || {}));
            const payload = full.data || {};
            try{ console.debug('doDownloadNow: payload summary tasks=', Object.keys(payload.tasks||{}).length, 'daily=', Object.keys(payload.daily||{}).length); }catch(_){ }
            importAllFromJsonObj(payload, {merge:true});
            lastLocalSnapshot = JSON.stringify(exportAllLocalStorageAsObject());
            renderAll();
            syncStatus && (syncStatus.textContent = 'ダウンロード完了: ' + new Date().toLocaleTimeString());
            console.debug('doDownloadNow: import applied, local keys=', Object.keys(exportAllLocalStorageAsObject()).length);
          } else {
            syncStatus && (syncStatus.textContent = 'リモートにデータがありません');
          }
        }catch(e){ console.warn('手動ダウンロード失敗', e); syncStatus && (syncStatus.textContent = 'ダウンロード失敗'); }
      }

      // Wire UI buttons if present
      try{
        const syncBtn = document.getElementById('syncNowBtn');
        const dlBtn = document.getElementById('downloadNowBtn');
        if(syncBtn) syncBtn.addEventListener('click', (e)=>{ e.preventDefault(); doUploadNow(); });
        if(dlBtn) dlBtn.addEventListener('click', (e)=>{ e.preventDefault(); doDownloadNow(); });
      }catch(e){ /* ignore wiring errors */ }

      // Subscribe to remote doc changes and merge when remote is newer
      function attachRemoteListener(uid){
        if(unsubscribeRemote) unsubscribeRemote();
        const docRef = db.collection('users').doc(uid);
        unsubscribeRemote = docRef.onSnapshot(doc => {
          if(!doc.exists) return;
          const data = doc.data() || {};
          const payload = data.data || {};
          const remoteTs = data.updatedAt ? (data.updatedAt.toMillis ? data.updatedAt.toMillis() : (new Date(data.updatedAt).getTime())) : 0;
          // If remote is newer than our last local write, apply it
          if(remoteTs && remoteTs > (lastLocalWrite + 500)){
            importAllFromJsonObj(payload, {merge:true});
            lastLocalSnapshot = JSON.stringify(exportAllLocalStorageAsObject());
            renderAll();
            syncStatus && (syncStatus.textContent = 'リモート更新受信: ' + new Date(remoteTs).toLocaleTimeString());
          }
        }, err => {
          console.warn('リモート監視エラー', err);
          try{ showSyncError(err); }catch(e){}
        });
      }

      // On sign out, cleanup
      function detachRemoteListener(){ if(unsubscribeRemote) { unsubscribeRemote(); unsubscribeRemote = null; } }

      // When auth changes to signed in, fetch initial remote and attach listener
      auth.onAuthStateChanged(async user => {
        console.debug('history.js auth.onAuthStateChanged (main):', { time: new Date().toISOString(), user: user ? { uid: user.uid, email: user.email } : null, authCurrentUser: (firebase && firebase.auth && firebase.auth().currentUser) ? { uid: firebase.auth().currentUser.uid } : null });
        if(user){
          console.debug('history.js: signed in -> fetching remote doc for', user.uid);
          setAuthUI(true, user.uid);
          try{
            const doc = await db.collection('users').doc(user.uid).get();
            console.debug('history.js: remote doc fetched, exists=', !!(doc && doc.exists));
            if(doc.exists){
              const payload = doc.data().data || {};
              importAllFromJsonObj(payload, {merge:true});
              lastLocalSnapshot = JSON.stringify(exportAllLocalStorageAsObject());
              // Push merged result back to remote to ensure both sides have same merged state
              scheduleAutoUpload();
            }
          }catch(e){ console.warn('初期リモート取得失敗', e); try{ showSyncError(e); }catch(_){ } }
          attachRemoteListener(user.uid);
        } else {
          console.debug('history.js: auth changed -> signed out');
          setAuthUI(false);
          detachRemoteListener();
        }
      });

      // Show user-friendly sync error messages in the UI
      function showSyncError(err){
        if(!syncStatus) return;
        try{
          const code = err && (err.code || err.message || '').toString();
          // FirebaseError codes sometimes look like 'permission-denied' or include that text
          if(code.indexOf('permission-denied') !== -1 || (err && err.message && err.message.indexOf('permission-denied') !== -1)){
            syncStatus.textContent = '同期失敗: Firestore の権限エラーです。Firebase コンソールで Firestore のルールを確認してください。';
            return;
          }
          if(err && err.message && err.message.indexOf('has not been used') !== -1 || (err && err.code && err.code.indexOf('failed-precondition')!==-1)){
            syncStatus.textContent = '同期失敗: Cloud Firestore API が有効になっていない可能性があります。Google Cloud コンソールで Firestore API を有効にしてください。';
            return;
          }
          if(err && err.message && err.message.indexOf('client is offline') !== -1){
            syncStatus.textContent = '同期中: ネットワークに接続されていないためオフラインモードです。接続を確認してください。';
            return;
          }
          // Fallback: show concise message and suggest opening console for details
          syncStatus.textContent = '同期エラーが発生しました（詳細は Console を確認）。';
        }catch(e){ /* noop */ }
      }

      firebaseInited = true;
    }catch(err){ console.warn('Firebase init error', err); setAuthUI(false); }
  }

  // Try to initialize Firebase (if SDK loaded later, you can call this from console)
  try{ initFirebaseIfAvailable(); }catch(e){ console.warn('init firebase failed', e); }
  // No history-page sign-in UI: top-page modal handles sign-in and auth state persists across pages.
  
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
