/** Keep a fan's influence local to the continuous overlap that starts at its
 * junction. A looping ramp encountered again later is not still its neighbour.
 * Work in distance along the entire chain, so way/tile splits cannot reset the
 * taper or create a sudden sideways jump in asphalt, paint, or traffic. */
export function taperGore(chain, step, clearGap, otherLaneSpan) {
  const samples = [];
  for (const entry of chain) {
    for (let i = 0; i < entry.gaps.length; i++) {
      const s = Math.min(entry.length, i * step);
      samples.push({ entry, i, d: entry.from + (entry.end ? entry.length - s : s),
        gap: entry.gaps[i] });
    }
  }
  samples.sort((a,b) => a.d-b.d);
  const last = samples.find(p => !Number.isFinite(p.gap)
    || p.gap < -(p.entry.laneSpan + otherLaneSpan) / 2 - 0.3);
  if (!last) return;
  const end = last.d, run = Math.min(end, Math.max(48, otherLaneSpan * 12));
  for (const p of samples) {
    if (p.d >= end || !Number.isFinite(p.gap)) { p.entry.gaps[p.i] = clearGap; continue; }
    const t = Math.max(0, Math.min(1, (p.d - (end - run)) / (run || 1)));
    const fade = t*t*(3-2*t);
    p.entry.gaps[p.i] = p.gap + (clearGap-p.gap)*fade;
  }
}
