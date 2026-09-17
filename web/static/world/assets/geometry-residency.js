/** Keep decoded geometry inside the worker's existing slot until its scene and
 * physics commit ends. A fast worker must not fill a slow phone's commit queue. */
export function holdGeometrySlot(slot, job, enabled, pump) {
  if (!enabled || !job?.pending) return;
  slot.busy = true;
  slot.commitJob = job;
  const release = () => {
    if (slot.commitJob !== job) return;
    slot.commitJob = null; slot.busy = false; pump();
  };
  job.done.then(release, release);
}

export function releaseGeometryRequest(active, id, request, enabled, pump) {
  if (!enabled) { active.delete(id); return; }
  const release = () => {
    if (active.get(id) !== request) return;
    active.delete(id); pump();
  };
  request.job.done.then(release, release);
}
