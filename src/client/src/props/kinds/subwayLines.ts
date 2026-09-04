/**
 * Line bullets for a subway entrance. The world data rarely carries the line list, so the lines are
 * resolved from the nearest known Manhattan station (world metres from the shared projection) and,
 * failing that, from the avenue the entrance stands on (the trunk lines run under their avenues).
 * Known station titles travel after the route list as `routes|title|subtitle` in the subway-only
 * atlas key. Placement still consumes the same string; coordinates, orientation and seeds are untouched.
 */
import { lonLatToXZ } from '@shared/geo';
import { hash01 } from '../builder';

const STATIONS: [lat: number, lon: number, lines: string, title?: string, subtitle?: string][] = [
  [40.7557, -73.9870, 'N Q R W 1 2 3 7', 'Times Sq–42 St', 'Subway Station'],
  [40.7574, -73.9899, 'A C E', '42 St–Port Authority', 'Bus Terminal Station'],
  [40.7541, -73.9844, 'B D F M 7', '42 St–Bryant Park', '5 Avenue'],
  [40.7527, -73.9772, '4 5 6 7', 'Grand Central', '42 Street Station'],
  [40.7497, -73.9878, 'B D F M N Q R W'], [40.7506, -73.9911, '1 2 3'],
  [40.7522, -73.9932, 'A C E'], [40.7349, -73.9906, '4 5 6 L N Q R W'], [40.7300, -73.9915, '6'],
  [40.7305, -73.9925, 'N R W'], [40.7323, -74.0003, 'A C E B D F M'], [40.7331, -74.0071, '1'],
  [40.7378, -73.9982, '1 2 3'], [40.7381, -73.9963, 'F M L'], [40.7404, -74.0020, 'A C E L'],
  [40.7188, -74.0006, 'N Q R W J Z 6'], [40.7226, -74.0062, '1'], [40.7102, -74.0079, '2 3 4 5 A C J Z'],
  [40.7069, -74.0091, '2 3'], [40.7075, -74.0119, '4 5'], [40.7049, -74.0141, '4 5'], [40.7150, -74.0092, '1 2 3'],
  [40.7681, -73.9819, 'A B C D 1'], [40.7646, -73.9806, 'N Q R W'], [40.7645, -73.9733, 'N R W'],
  [40.7626, -73.9675, '4 5 6 N R W'], [40.7576, -73.9694, 'E M 6'], [40.7571, -73.9720, '6'],
  [40.7587, -73.9812, 'B D F M'], [40.7597, -73.9843, 'N R W'], [40.7623, -73.9860, 'C E'], [40.7616, -73.9838, '1'],
  [40.7433, -73.9842, '6'], [40.7471, -73.9935, '1'], [40.7454, -73.9886, 'R W'], [40.7398, -73.9865, '6'],
  [40.7440, -73.9954, '1'], [40.7429, -73.9925, 'F M'], [40.7413, -73.9895, 'R W'], [40.7458, -73.9987, 'C E'],
  [40.8076, -73.9457, '2 3'], [40.8043, -73.9375, '4 5 6'], [40.7838, -73.9799, '1'], [40.7785, -73.9819, '1 2 3'],
  [40.7795, -73.9556, '4 5 6'], [40.7184, -73.9882, 'F J M Z'], [40.7237, -73.9899, 'F'], [40.7257, -73.9945, '6 B D F M'],
  [40.7222, -73.9973, '6'], [40.7262, -74.0037, 'C E'], [40.7244, -73.9977, 'N R W'], [40.7139, -73.9902, 'F'],
  [40.7183, -73.9938, 'B D'], [40.7204, -73.9938, 'J Z'], [40.7134, -74.0067, 'R W'], [40.7132, -74.0041, '4 5 6 J Z'],
  [40.7115, -74.0121, 'R W 1'], [40.7123, -74.0099, 'E'], [40.7076, -74.0132, '1'], [40.7072, -74.0131, 'R W'],
  [40.7018, -74.0132, '1'], [40.7032, -74.0129, 'R W'], [40.7192, -74.0067, '1'], [40.7285, -74.0053, '1'],
  [40.7554, -74.0018, '7'], [40.7539, -73.9819, '7', '5 Avenue', '42 Street Station'], [40.7461, -73.9822, '6'], [40.7627, -73.9679, '4 5 6'],
  [40.7733, -73.9640, '6'], [40.7686, -73.9660, '6'], [40.7744, -73.9829, '1 2 3'], [40.7854, -73.9762, '1'],
  [40.7930, -73.9721, '1'], [40.7757, -73.9762, 'B C'], [40.7816, -73.9722, 'B C'], [40.7888, -73.9695, 'B C'],
];
let stations: { x: number; z: number; lines: string }[] | null = null;

const AVENUE: [RegExp, string][] = [
  [/lexington/i, '6'], [/park av/i, '6'], [/(seventh|7th) av/i, '1 2 3'], [/varick|west broadway|greenwich st/i, '1'],
  [/(eighth|8th) av|central park west/i, 'A C E'], [/(sixth|6th) av|americas/i, 'B D F M'], [/houston/i, 'F'],
  [/canal/i, 'N Q R W'], [/14th|fourteenth/i, 'L'], [/42nd/i, '7'], [/nassau|fulton|william/i, 'J Z'],
  [/(second|2nd) av/i, 'Q'], [/lafayette|bowery/i, '6'], [/broadway/i, 'N R W'], [/lenox|malcolm/i, '2 3'],
];
const FALLBACK = ['1', '6', 'N R W', 'A C E', 'B D F M', 'L', '4 5 6', '2 3', 'F', 'R W'];

export function subwayLines(x: number, z: number, roadName: string | null | undefined, seed: number): string {
  if (!stations) stations = STATIONS.map(([lat, lon, lines, title, subtitle]) => ({
    ...lonLatToXZ(lon, lat), lines: title ? `${lines}|${title}|${subtitle ?? 'Subway Station'}` : lines,
  }));
  let best: string | null = null, distance = 260 * 260;
  for (const s of stations) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < distance) { distance = d; best = s.lines; }
  }
  if (best) return best;
  if (roadName) for (const [re, lines] of AVENUE) if (re.test(roadName)) return lines;
  return FALLBACK[Math.floor(hash01(Math.round(seed * 1e6), 7) * FALLBACK.length)];
}
