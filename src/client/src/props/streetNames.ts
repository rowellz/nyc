/**
 * NYC street sign abbreviation, a port of tools/lib/props.mjs signName() so runtime road lookups match
 * the sign text in the tile data ("W 42 ST", "5 AV", "BROADWAY").
 */
const WORDS: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AV', AVE: 'AV', WEST: 'W', EAST: 'E', NORTH: 'N', SOUTH: 'S', PLACE: 'PL', BOULEVARD: 'BLVD', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', PARKWAY: 'PKWY', SQUARE: 'SQ', TERRACE: 'TER', COURT: 'CT', EXPRESSWAY: 'EXPWY', HIGHWAY: 'HWY', BRIDGE: 'BR', SAINT: 'ST', ALLEY: 'ALY', PLAZA: 'PLZ', CIRCLE: 'CIR', WALK: 'WALK', ROW: 'ROW', SLIP: 'SLIP', LOOP: 'LOOP', PIER: 'PIER', HEIGHTS: 'HTS', JUNIOR: 'JR', REVEREND: 'REV', DOCTOR: 'DR', MOUNT: 'MT', FORT: 'FT', TUNNEL: 'TUNL', APPROACH: 'APPR', EXIT: 'EXIT', VIADUCT: 'VIA',
};
const SPECIAL: Record<string, string> = {
  'AVENUE OF THE AMERICAS': '6 AV',
  'FASHION AVENUE': '7 AV',
  'CENTRAL PARK WEST': 'CENTRAL PARK W',
  'CENTRAL PARK SOUTH': 'CENTRAL PARK S',
  'CENTRAL PARK NORTH': 'CENTRAL PARK N',
  'FDR DRIVE': 'FDR DR',
  'FRANKLIN D. ROOSEVELT EAST RIVER DRIVE': 'FDR DR',
  'WEST SIDE HIGHWAY': 'WEST SIDE HWY',
  'JOE DIMAGGIO HIGHWAY': 'WEST SIDE HWY',
  'ADAM CLAYTON POWELL JR. BOULEVARD': 'ADAM C POWELL BLVD',
  'FREDERICK DOUGLASS BOULEVARD': 'FREDERICK DOUGLASS BLVD',
  'MALCOLM X BOULEVARD': 'MALCOLM X BLVD',
  'MARTIN LUTHER KING JR. BOULEVARD': 'M L KING JR BLVD',
  'ST. NICHOLAS AVENUE': 'ST NICHOLAS AV',
  'AVENUE A': 'AV A',
  'AVENUE B': 'AV B',
  'AVENUE C': 'AV C',
  'AVENUE D': 'AV D',
};

const cache = new Map<string, string>();

export function signName(name: string | null | undefined): string {
  if (!name) return '';
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  let s = name.toUpperCase().replace(/\s+/g, ' ').trim();
  let out: string;
  if (SPECIAL[s]) out = SPECIAL[s];
  else {
    s = s.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1');
    s = s.replace(/[.,']/g, '');
    const parts = s.split(' ').map((w) => WORDS[w] || w);
    out = parts.join(' ');
    if (out.length > 22) out = out.slice(0, 22).trim();
  }
  cache.set(name, out);
  return out;
}
