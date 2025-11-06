// storage.js - storage helpers for Sand Study (localStorage wrapper)
export function keyDay(d = new Date()){ return d.toISOString().slice(0,10); }

export function loadCumBase(){ const base = localStorage.getItem("cum_base"); return base ? +base : 0; }

export function rolloverIfNeeded(){
  try{
    const last = localStorage.getItem("last_date");
    const todayStr = keyDay();
    if(last && last !== todayStr){
      const prevRaw = localStorage.getItem(`daily:${last}`);
      if(prevRaw){
        try{
          const y = JSON.parse(prevRaw);
          const add = (y.bottlesToday||0);
          localStorage.setItem("cum_base", String((+loadCumBase()) + add));
        }catch(e){/* ignore */}
      }
    }
    localStorage.setItem("last_date", todayStr);
  }catch(e){ console.warn('rolloverIfNeeded failed', e); }
}

export function loadToday(){
  try{
    rolloverIfNeeded();
    const key = `daily:${keyDay()}`;
    const raw = localStorage.getItem(key);
    if(raw) return JSON.parse(raw);
    return { date: keyDay(), layerTotal:0, bottlesToday:0, bottlesCum: loadCumBase() };
  }catch(e){ console.error('loadToday failed', e); return { date: keyDay(), layerTotal:0, bottlesToday:0, bottlesCum: loadCumBase() }; }
}

export function saveToday(d){ try{ localStorage.setItem(`daily:${keyDay()}`, JSON.stringify(d)); return true; }catch(e){ console.error('saveToday failed', e); return false; } }

export function loadTasksForDay(dayKey = `tasks:${keyDay()}`){
  try{ return JSON.parse(localStorage.getItem(dayKey) || "[]") || []; }catch(e){ console.error('loadTasksForDay failed', e); return []; }
}

export function saveTask(t){
  try{
    const key = `tasks:${keyDay()}`;
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    arr.push(t);
    localStorage.setItem(key, JSON.stringify(arr));
    try{ if(typeof window !== 'undefined' && window.dispatchEvent){ window.dispatchEvent(new CustomEvent('sandstudy:tasks-changed',{detail:{action:'save', id:t && t.id}})); } }catch(e){}
    return true;
  }catch(e){ console.error('saveTask failed', e); return false; }
}

export function updateTask(id, updates){
  try{
    const key = `tasks:${keyDay()}`;
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    const idx = arr.findIndex(x => x && x.id === id);
    if(idx === -1) return false;
    const item = arr[idx];
    const allowed = ['mood','effort','taskname','insight','nexttask'];
    allowed.forEach(k => { if(typeof updates[k] !== 'undefined') item[k] = updates[k]; });
    arr[idx] = item;
    localStorage.setItem(key, JSON.stringify(arr));
    try{ if(typeof window !== 'undefined' && window.dispatchEvent){ window.dispatchEvent(new CustomEvent('sandstudy:tasks-changed',{detail:{action:'update', id}})); } }catch(e){}
    return true;
  }catch(e){ console.error('updateTask failed', e); return false; }
}

export function deleteTask(id){
  try{
    const key = `tasks:${keyDay()}`;
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    const newArr = arr.filter(x => x && x.id !== id);
    localStorage.setItem(key, JSON.stringify(newArr));
    try{ if(typeof window !== 'undefined' && window.dispatchEvent){ window.dispatchEvent(new CustomEvent('sandstudy:tasks-changed',{detail:{action:'delete', id}})); } }catch(e){}
    return true;
  }catch(e){ console.error('deleteTask failed', e); return false; }
}
