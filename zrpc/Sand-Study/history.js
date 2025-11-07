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

function renderChart(canvasId, label, data, heatmapData, startDate, endDate){
  const canvas = document.getElementById(canvasId);
  if(!canvas){ console.warn('Canvas not found', canvasId); return; }
  const ctx = canvas.getContext('2d');
  if(window[canvasId+'Chart']){ try{ window[canvasId+'Chart'].destroy(); }catch(e){} }
  
  // Create heatmap data: x=hour (0-23), y=day, value=average
  const days = dateRange(startDate, endDate);
  const heatData = [];
  
  days.forEach((day, dayIndex) => {
    for(let hour = 0; hour < 24; hour++){
      const key = `${day}:${hour}`;
      const values = heatmapData[key];
      if(values && values.length > 0){
        const avg = values.reduce((a,b)=>a+b,0) / values.length;
        heatData.push({
          x: hour,
          y: dayIndex,
          v: avg.toFixed(2)
        });
      }
    }
  });
  
  // Color scale: low (blue) -> high (red)
  const getColor = (value) => {
    if(!value) return 'rgba(200,200,200,0.1)';
    const v = parseFloat(value);
    // Assuming scale 1-5
    const ratio = (v - 1) / 4; // normalize to 0-1
    const hue = (1 - ratio) * 240; // 240=blue, 0=red
    return `hsla(${hue}, 70%, 50%, 0.7)`;
  };
  
  window[canvasId+'Chart'] = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        label: label,
        data: heatData.map(d => ({
          x: d.x,
          y: d.y,
          r: 15, // bubble radius
          value: d.v
        })),
        backgroundColor: heatData.map(d => getColor(d.v)),
        borderColor: 'rgba(0,0,0,0.2)',
        borderWidth: 1
      }]
    },
    options: {
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 23,
          ticks: { stepSize: 1, callback: (v) => `${v}:00` },
          title: { display: true, text: '時刻' }
        },
        y: {
          type: 'linear',
          min: -0.5,
          max: days.length - 0.5,
          ticks: { stepSize: 1, callback: (v) => days[Math.floor(v)] || '' },
          title: { display: true, text: '日付' }
        }
      },
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const point = ctx.raw;
              return `${label}: ${point.value} (${point.x}:00, ${days[point.y]})`;
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
    renderChart('moodChart','平均 mood', agg.avgMood.map(v=> v===null? null: Number(v.toFixed(2))), agg.dailyHourlyMood, s, e);
    renderChart('effortChart','平均 effort', agg.avgEff.map(v=> v===null? null: Number(v.toFixed(2))), agg.dailyHourlyEff, s, e);
    renderBottleList(s,e);
    // attach csv export
    document.getElementById('exportCsv').onclick = ()=> exportCsv(entries);
  });
});
