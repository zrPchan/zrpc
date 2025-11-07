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
  
  // Create heatmap data: x=hour (0-23), y=day, color=most frequent score
  const days = dateRange(startDate, endDate);
  const heatData = [];
  
  // Find max frequency for color scaling
  let maxFreq = 0;
  Object.values(freqData).forEach(hourData => {
    Object.values(hourData).forEach(count => {
      if(count > maxFreq) maxFreq = count;
    });
  });
  
  days.forEach((day, dayIndex) => {
    for(let hour = 0; hour < 24; hour++){
      const key = `${day}:${hour}`;
      const freq = freqData[key];
      if(freq && Object.keys(freq).length > 0){
        // Find most frequent score
        let mostFreqScore = null;
        let mostFreqCount = 0;
        Object.entries(freq).forEach(([score, count]) => {
          if(count > mostFreqCount){
            mostFreqCount = count;
            mostFreqScore = parseInt(score);
          }
        });
        
        heatData.push({
          x: hour,
          y: dayIndex,
          score: mostFreqScore,
          count: mostFreqCount,
          total: Object.values(freq).reduce((a,b)=>a+b,0)
        });
      }
    }
  });
  
  // Fine-grained color scale based on score (1-5) with vibrancy based on frequency
  const getColor = (score, count, maxCount) => {
    if(!score) return 'rgba(200,200,200,0.1)';
    
    // Base color by score: 1=deep blue, 2=light blue, 3=yellow, 4=orange, 5=deep red
    const colorMap = {
      1: [59, 130, 246],   // blue
      2: [96, 165, 250],   // light blue
      3: [250, 204, 21],   // yellow
      4: [251, 146, 60],   // orange
      5: [239, 68, 68]     // red
    };
    
    const [r, g, b] = colorMap[score] || [150, 150, 150];
    
    // Opacity based on frequency (more frequent = more opaque)
    const opacity = 0.4 + (count / maxCount) * 0.6; // 0.4 to 1.0
    
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };
  
  window[canvasId+'Chart'] = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        label: label,
        data: heatData.map(d => ({
          x: d.x,
          y: d.y,
          r: 8 + (d.count / maxFreq) * 12, // radius 8-20 based on frequency
          score: d.score,
          count: d.count,
          total: d.total
        })),
        backgroundColor: heatData.map(d => getColor(d.score, d.count, maxFreq)),
        borderColor: 'rgba(0,0,0,0.3)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2,
      scales: {
        x: {
          type: 'linear',
          min: -0.5,
          max: 23.5,
          ticks: { 
            stepSize: 2,
            callback: (v) => Number.isInteger(v) ? `${v}時` : '',
            font: { size: 11 }
          },
          title: { display: true, text: '時刻', font: { size: 13, weight: 'bold' } },
          grid: { color: 'rgba(150,150,150,0.15)', drawTicks: true }
        },
        y: {
          type: 'linear',
          min: -0.5,
          max: days.length - 0.5,
          ticks: { 
            stepSize: 1,
            callback: (v) => {
              const idx = Math.round(v);
              return (idx >= 0 && idx < days.length) ? days[idx].slice(5) : ''; // MM-DD format
            },
            font: { size: 10 }
          },
          title: { display: true, text: '日付 (月-日)', font: { size: 13, weight: 'bold' } },
          grid: { color: 'rgba(150,150,150,0.15)', drawTicks: true }
        }
      },
      plugins: {
        legend: { 
          display: true,
          labels: { font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const point = ctx.raw;
              return [
                `最頻値: ${point.score}点`,
                `出現: ${point.count}回 / ${point.total}回`,
                `時刻: ${point.x}:00`,
                `日付: ${days[point.y]}`
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
