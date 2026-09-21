// Drive the real shared scene queue deterministically in Node runtime fixtures.
export function sceneFrameClock() {
  const originalRAF=globalThis.requestAnimationFrame,originalPerformance=globalThis.performance;
  let clock=0,frames=[];
  globalThis.performance={now:()=>clock+=.1};
  globalThis.requestAnimationFrame=fn=>{frames.push(fn);return 1;};
  return {
    frame(){const batch=frames;frames=[];for(const fn of batch)fn();},
    restore(){
      globalThis.performance=originalPerformance;
      if(originalRAF===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=originalRAF;
    },
  };
}
