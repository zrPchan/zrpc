// src/timer.js
// A small timer abstraction used by the app. Works with seconds-level precision.
export function createTimer({ onTick = ()=>{}, onTarget = ()=>{}, onOvertime = ()=>{}, targetSeconds = 300 } = {}){
  let intervalId = null;
  let startAt = null; // epoch seconds
  let pausedElapsed = 0; // seconds
  let running = false;
  let targetReached = false;

  function nowSec(){ return Math.floor(Date.now()/1000); }
  function getElapsed(){
    if(!startAt) return pausedElapsed;
    return running ? Math.floor(nowSec() - startAt) : pausedElapsed;
  }

  function tick(){
    const elapsed = getElapsed();
    const capped = Math.min(elapsed, targetSeconds);
    const remaining = Math.max(0, targetSeconds - capped);
    try{ onTick(elapsed, remaining); }catch(e){ console.error('onTick handler failed', e); }
    // Call onTarget only once when crossing the threshold to avoid repeated triggers.
    if(elapsed >= targetSeconds && !targetReached){
      targetReached = true;
      try{ onTarget(); }catch(e){ console.error('onTarget handler failed', e); }
    }
    // onOvertime may be called repeatedly while elapsed > targetSeconds to allow
    // the app to show overtime behavior, but avoid calling onOvertime on the same
    // tick as the initial onTarget if not desired by the app logic.
    if(elapsed > targetSeconds){
      try{ onOvertime(elapsed); }catch(e){ console.error('onOvertime handler failed', e); }
    }
  }

  function start(){
    if(running) return;
    startAt = nowSec() - pausedElapsed;
    // Reset targetReached when starting so a fresh session can trigger target again.
    targetReached = false;
    intervalId = setInterval(tick, 1000);
    running = true;
    tick();
  }

  function pause(){
    if(!running) return;
    pausedElapsed = getElapsed();
    if(intervalId){ clearInterval(intervalId); intervalId = null; }
    running = false;
  }

  function resume(){ start(); }

  function stop(){
    if(intervalId){ clearInterval(intervalId); intervalId = null; }
    running = false;
    pausedElapsed = 0;
    startAt = null;
    targetReached = false;
  }

  function setTarget(s){ targetSeconds = Number(s) || targetSeconds; targetReached = false; }

  return { start, pause, resume, stop, getElapsed, isRunning: ()=>running, setTarget };
}
