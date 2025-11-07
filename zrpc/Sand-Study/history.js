// history.js - aggregate localStorage data and render charts for time-of-day vs mood/effort
// Chart.js is loaded via CDN in history.html and exposed as global `Chart`.

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
  if(window[canvasId+'Chart']){ try{ window[canvasId+'Chart'].destroy(); }catch(e){} }
  
  // Validate freqData
  if(!freqData || typeof freqData !== 'object'){
    console.error('Invalid freqData:', freqData);
    return;
  }
  
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
  
  // Calculate total count per hour and deviation score (偏差値)
  const heatData = [];
  const allCounts = [];
  
  // First pass: collect all counts for mean/stddev calculation
  for(let hour = 0; hour < 24; hour++){
    const scores = hourlyFreq[hour];
    Object.values(scores).forEach(count => allCounts.push(count));
  }
  
  // Calculate mean and standard deviation
  const mean = allCounts.length > 0 ? allCounts.reduce((a,b)=>a+b,0) / allCounts.length : 0;
  const variance = allCounts.length > 0 ? allCounts.reduce((a,b)=>a+Math.pow(b-mean,2),0) / allCounts.length : 1;
  const stdDev = Math.sqrt(variance);
  
  // Create heatmap matrix data
  const matrixData = [];
  for(let hour = 0; hour < 24; hour++){
    const scores = hourlyFreq[hour];
    
    // For each score value (1-5), calculate frequency and deviation
    for(let scoreVal = 1; scoreVal <= 5; scoreVal++){
      const count = scores[scoreVal] || 0;
      // Calculate deviation score (偏差値): 50 + 10 * (x - mean) / stdDev
      const deviation = count > 0 && stdDev > 0 ? 50 + 10 * (count - mean) / stdDev : (count > 0 ? 50 : 0);
      
      matrixData.push({
        x: hour,
        y: scoreVal,
        v: Math.max(0, Math.min(100, deviation)) // deviation value (0-100)
      });
    }
  }
  
  // Color scale based on deviation score (heatmap gradient)
  const getColor = (deviation) => {
    if(deviation === 0) return 'rgba(240, 240, 240, 0.3)'; // no data
    // Gradient: blue (low) -> cyan -> green -> yellow -> orange -> red (high)
    const colors = [
      { dev: 0, rgb: [59, 130, 246] },    // blue
      { dev: 30, rgb: [34, 197, 94] },    // green
      { dev: 50, rgb: [250, 204, 21] },   // yellow
      { dev: 70, rgb: [251, 146, 60] },   // orange
      { dev: 100, rgb: [239, 68, 68] }    // red
    ];
    
    // Find interpolation range
    for(let i = 0; i < colors.length - 1; i++){
      if(deviation >= colors[i].dev && deviation <= colors[i+1].dev){
        const t = (deviation - colors[i].dev) / (colors[i+1].dev - colors[i].dev);
        const r = Math.round(colors[i].rgb[0] + t * (colors[i+1].rgb[0] - colors[i].rgb[0]));
        const g = Math.round(colors[i].rgb[1] + t * (colors[i+1].rgb[1] - colors[i].rgb[1]));
        const b = Math.round(colors[i].rgb[2] + t * (colors[i+1].rgb[2] - colors[i].rgb[2]));
        return `rgba(${r}, ${g}, ${b}, 0.85)`;
      }
    }
    return 'rgba(239, 68, 68, 0.85)'; // fallback red
  };
  
  window[canvasId+'Chart'] = new Chart(ctx, {
    type: 'matrix',
    data: {
      datasets: [{
        label: label,
        data: matrixData,
        backgroundColor: (context) => {
          const value = context.dataset.data[context.dataIndex];
          return value ? getColor(value.v) : 'rgba(240,240,240,0.3)';
        },
        borderColor: 'rgba(200, 200, 200, 0.3)',
        borderWidth: 1,
        width: ({chart}) => (chart.chartArea || {}).width / 24 * 0.95,
        height: ({chart}) => (chart.chartArea || {}).height / 5 * 0.95
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 3,
      scales: {
        x: {
          type: 'linear',
          min: -0.5,
          max: 23.5,
          offset: false,
          ticks: { 
            stepSize: 2,
            callback: (v) => Number.isInteger(v) && v >= 0 && v <= 23 ? `${v}時` : '',
            font: { size: 11 }
          },
          title: { display: true, text: '時刻', font: { size: 14, weight: 'bold' } },
          grid: { display: false }
        },
        y: {
          type: 'linear',
          min: 0.5,
          max: 5.5,
          offset: false,
          ticks: { 
            stepSize: 1,
            callback: (v) => Number.isInteger(v) && v >= 1 && v <= 5 ? `${v}点` : '',
            font: { size: 11 }
          },
          title: { display: true, text: '評価値', font: { size: 14, weight: 'bold' } },
          grid: { display: false }
        }
      },
      plugins: {
        legend: { 
          display: true,
          labels: { font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            title: () => '',
            label: (ctx) => {
              const value = ctx.dataset.data[ctx.dataIndex];
              const hour = value.x;
              const score = value.y;
              const dev = value.v.toFixed(1);
              return [
                `時刻: ${hour}:00`,
                `評価値: ${score}点`,
                `偏差値: ${dev}`
              ];
            }
          }
        }
      }
    }
  });
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

  document.getElementById('drawBtn').addEventListener('click', ()=>{
    const s = parseDateInput('startDate'); const e = parseDateInput('endDate');
    if(!s||!e){ alert('開始日と終了日を選択してください'); return; }
    const entries = loadTasksForRange(s,e);
  if(window && window.__DEV__){ console.log('loaded entries count', entries.length); }
    const status = document.getElementById('historyStatus');
    if(status) status.textContent = `読み込んだエントリ: ${entries.length}`;
    if(entries.length === 0){
      if(status) status.textContent = '読み込んだエントリ: 0（データがありません）';
      // clear charts if present
      if(window['moodChartChart']) try{ window['moodChartChart'].destroy(); }catch(e){}
      if(window['effortChartChart']) try{ window['effortChartChart'].destroy(); }catch(e){}
      const container = document.getElementById('bottleList'); if(container) container.innerHTML = '<div class="log-empty">データがありません</div>';
      alert('選択範囲にデータが見つかりません');
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
  });
});
