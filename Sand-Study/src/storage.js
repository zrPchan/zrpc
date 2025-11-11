// storage.js - storage helpers for Sand Study (localStorage wrapper)
export function keyDay(d = new Date()){ 
  // Use local timezone instead of UTC for Japanese users
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
    // ensure the task has a unique id
    try{
      if(!t.id){
        if(typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') t.id = crypto.randomUUID();
        else t.id = 'id-' + Date.now() + '-' + Math.floor(Math.random()*100000);
      }
    }catch(e){ if(!t.id) t.id = 'id-' + Date.now() + '-' + Math.floor(Math.random()*100000); }
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
    // Search across all stored `tasks:YYYY-MM-DD` entries to find the task's date
    let found = false;
    let foundDay = null;
    let foundItem = null;
    // iterate localStorage keys
    for(let i=0;i<localStorage.length;i++){
      try{
        const k = localStorage.key(i);
        if(!k || !k.startsWith('tasks:')) continue;
        const arr = JSON.parse(localStorage.getItem(k) || "[]");
        const idx = arr.findIndex(x => x && x.id === id);
        if(idx !== -1){
          // remove and save
          const item = arr[idx];
          arr.splice(idx,1);
          localStorage.setItem(k, JSON.stringify(arr));
          found = true;
          foundDay = k.slice('tasks:'.length); // YYYY-MM-DD
          foundItem = item;
          break;
        }
      }catch(e){ /* ignore parse errors and continue */ }
    }
    if(!found){
      // nothing to delete
      return false;
    }
    // compute removed layers and update the matching daily:YYYY-MM-DD record
    try{
      const item = foundItem;
      const UNIT_SEC = 37.5;
      let elapsed = 0;
      if(typeof item.elapsedSec === 'number') elapsed = item.elapsedSec;
      else if(item.end && item.start) elapsed = (item.end - item.start) || 0;
      let removedLayers = 0;
      if(elapsed >= 60){ removedLayers = Math.floor(elapsed / UNIT_SEC); }
      else if(typeof item.layer === 'number'){ removedLayers = item.layer || 0; }
      const todayKey = `daily:${foundDay}`;
      try{
        const raw = localStorage.getItem(todayKey);
        if(raw){
          const d = JSON.parse(raw || "{}");
          d.layerTotal = Math.max(0, (d.layerTotal || 0) - removedLayers);
          d.bottlesToday = Math.floor((d.layerTotal || 0) / 100);
          d.bottlesCum = loadCumBase() + d.bottlesToday;
          localStorage.setItem(todayKey, JSON.stringify(d));
        }
      }catch(e){ /* ignore today update failure */ }
    }catch(e){ /* ignore compute errors */ }
    try{ if(typeof window !== 'undefined' && window.dispatchEvent){ window.dispatchEvent(new CustomEvent('sandstudy:tasks-changed',{detail:{action:'delete', id}})); } }catch(e){}
    return true;
  }catch(e){ console.error('deleteTask failed', e); return false; }
}
