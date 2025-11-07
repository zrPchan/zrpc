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
  // returns arrays length 24: avg mood, avg effort, counts
  const sumsMood = Array(24).fill(0);
  const sumsEff = Array(24).fill(0);
  const counts = Array(24).fill(0);
  for(const t of entries){
    const ts = (t.start || t.createdAt || Date.now()/1000) * 1000;
    const date = new Date(ts);
    const h = date.getHours();
    if(typeof t.mood === 'number' || !isNaN(Number(t.mood))){ sumsMood[h] += Number(t.mood); }
    if(typeof t.effort === 'number' || !isNaN(Number(t.effort))){ sumsEff[h] += Number(t.effort); }
    counts[h] += 1;
  }
  const avgMood = sumsMood.map((s,i)=> counts[i]? s/counts[i] : null);
  const avgEff = sumsEff.map((s,i)=> counts[i]? s/counts[i] : null);
  return {avgMood, avgEff, counts};
}

function renderChart(canvasId, label, data){
  const canvas = document.getElementById(canvasId);
  if(!canvas){ console.warn('Canvas not found', canvasId); return; }
  const ctx = canvas.getContext('2d');
  if(window[canvasId+'Chart']){ try{ window[canvasId+'Chart'].destroy(); }catch(e){} }
  // handle nulls by leaving gaps
  window[canvasId+'Chart'] = new Chart(ctx, {
    type: 'line',
    data: { labels: Array.from({length:24},(_,i)=> `${i}:00`), datasets:[{ label, data, borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.08)', spanGaps:true, tension:0.2 }] },
    options: { scales:{ y:{ beginAtZero:false } }, plugins:{ legend:{ display:true } } }
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
    renderChart('moodChart','平均 mood', agg.avgMood.map(v=> v===null? null: Number(v.toFixed(2))));
    renderChart('effortChart','平均 effort', agg.avgEff.map(v=> v===null? null: Number(v.toFixed(2))));
    renderBottleList(s,e);
    // attach csv export
    document.getElementById('exportCsv').onclick = ()=> exportCsv(entries);
  });
});
