/**
 * Real positions, footprints and dimensions of the landmarks (world meters, shared/geo.ts projection).
 * Footprints were extracted from the NYC building footprints in client/public/world tiles (BIN-keyed) so the
 * models sit exactly where the buildings module would have put the generic extrusion. Where a footprint is not
 * in the data (the Empire State Building is missing from the current tiles; downtown is not built yet) the
 * footprint is derived from the street grid / known coordinates.
 */
import { lonLatToXZ } from '@shared/geo';
import type { Ring } from '@shared/world';

export const ESB = {
  bin: 1015862,
  /** NE corner of the lot (5th Ave & 34th St building lines), from the 5th Ave / W 34th centerlines in the tiles */
  cornerNE: { x: -132.6, z: 577.4 },
  /** lot: 197'6" on 5th Ave x 425' along 33rd/34th */
  lotU: 60.2, // along 5th Ave (north -> south)
  lotV: 129.5, // along 34th (east -> west)
  bearingU: 209, // 5th Ave, heading downtown (south-south-west)
};

export const CHRYSLER = {
  bin: 1036156,
  footprint: [[677.23, 242.46], [666.47, 256.76], [651.41, 248.42], [622.34, 232.31], [631.44, 215.99], [651.78, 179.49], [652.96, 180.14], [678.63, 194.37], [705.68, 209.36], [701.71, 216.54], [684.1, 234.63], [683.99, 234.75]] as Ring,
};

export const FLATIRON = {
  bin: 1016278,
  footprint: [[-535.13, 1361.55], [-534.83, 1361.46], [-531.64, 1355.27], [-531.45, 1355.13], [-531.23, 1355.05], [-531, 1355.03], [-530.77, 1355.07], [-530.56, 1355.18], [-530.39, 1355.34], [-530.27, 1355.54], [-530.21, 1355.76], [-531.05, 1362.37], [-530.91, 1362.48], [-530.58, 1362.86], [-530.29, 1363.27], [-529.82, 1365.24], [-529.87, 1365.73], [-535.59, 1419.26], [-535.76, 1419.64], [-535.98, 1419.99], [-536.25, 1420.31], [-536.57, 1420.58], [-536.93, 1420.8], [-537.31, 1420.96], [-537.72, 1421.07], [-538.14, 1421.11], [-538.56, 1421.1], [-538.97, 1421.02], [-539.37, 1420.88], [-539.74, 1420.69], [-540.41, 1420.31], [-559.62, 1409.56], [-559.98, 1409.24], [-560.3, 1408.87], [-560.57, 1408.47], [-560.78, 1408.03], [-560.92, 1407.57], [-561.01, 1407.1], [-561.03, 1406.61], [-560.99, 1406.13], [-560.88, 1405.66], [-560.71, 1405.21], [-560.48, 1404.78], [-536.79, 1362.65], [-536.43, 1362.3], [-536.03, 1361.99], [-535.59, 1361.74]] as Ring,
  roof: 82.0,
  parapet: 86.9,
};

/** One Times Square (1904, 1475 Broadway): the wedge between 7th Ave and Broadway at 42nd, 111 m to the roof. */
export const ONE_TIMES_SQUARE = {
  bin: 1022581,
  footprint: [[-267.57, -307.24], [-278.48, -264.64], [-295.06, -274.01], [-286.39, -289.26], [-285.68, -288.86], [-278.12, -302.16], [-273.37, -310.52], [-270.16, -308.7]] as Ring,
  height: 111,
  /** ball-drop flagpole on the north tip: 77 ft, the 3.7 m ball rests at the top */
  poleH: 23.5,
  /** LED wrap: from the 3rd floor to just under the roof */
  screenY0: 10,
  screenY1: 108,
};

/**
 * TKTS Duffy Square (2008): the red glass amphitheater. BIN 1085637 is the 4.9 m "TKTS" footprint sitting on the
 * bowtie axis at 47th; 27 steps rise ~5 m from the Father Duffy statue (south) up to 47th St (north).
 */
export const TKTS = {
  bins: [1085637],
  footprint: [[-147.64, -623.49], [-134.93, -616.45], [-143.13, -601.41], [-152.4, -606.4]] as Ring,
  steps: 27,
  rise: 4.9,
  /** Father Duffy statue plinth, on the axis south of the steps (m from the bottom step) */
  duffyOffset: 8.5,
};

/**
 * 4 Times Square's two rounded Broadway corners (fitted to the footprint): the cylindrical Nasdaq MarketSite
 * sign at 43rd (NW corner, 36 m tall) and the big curved display on the 42nd corner facing One Times Square.
 * Angles are three.js x/z (0 = +x east, +pi/2 = +z south).
 */
export const NASDAQ = { cx: -230.06, cz: -297.64, r: 9.1, y0: 4.0, y1: 40.0, a0: -2.95, a1: -1.15 };
export const FOUR_TS_CORNER = { cx: -234.51, cz: -256.88, r: 14.05, y0: 4.0, y1: 30.0, a0: 2.25, a1: 3.29 };

/** 2 Times Square (1990): the narrow 78 m billboard slab at the north tip of Duffy Square (47th) */
export const TWO_TIMES_SQUARE_BIN = 1024757;
/** 1500 Broadway (43rd-44th, east side): the ABC studios wrap */
export const FIFTEEN_HUNDRED_BROADWAY_BIN = 1022610;
/** the big curved LED wrapping 1500 Broadway's 44th St / Broadway corner (fitted to the footprint corner, r 8 m) */
export const FIFTEEN_HUNDRED_CORNER = { cx: -206.5, cz: -376.5, r: 8.0, y0: 4.0, y1: 30.0, a0: -2.80, a1: -1.07 };

/**
 * Paramount Building (1927, 1501 Broadway): the 33-storey setback tower on the west side of the square between
 * 43rd and 44th, crowned by the four-faced clock and the glass globe (about 130 m). Footprint from the tiles
 * (BIN 1024706): the 7th Ave front runs 60 m (u -30..30) and the block is 63 m deep (v -63..0, v pointing east).
 */
export const PARAMOUNT = {
  bin: 1024706,
  footprint: [[-336.92, -388.28], [-331.92, -397.31], [-329.13, -395.78], [-324.01, -405.03], [-318.3, -415.33], [-315.6, -418.41], [-314.48, -419.7], [-311.88, -424.82], [-308.93, -428.88], [-313.14, -431.2], [-311.05, -434.98], [-308.28, -439.97], [-307.39, -441.58], [-275.37, -423.94], [-256.95, -413.79], [-252.53, -411.35], [-266.05, -386.97], [-281.88, -358.39], [-282.07, -358.06]] as Ring,
  /** midpoint of the 7th Ave front and its bearing (uptown) */
  ox: -267.2,
  oz: -384.9,
  bearing: 29,
  /** the full-footprint base */
  base: 38,
  /** the stepped crown: [width along the front, depth, y0, y1, centre v] */
  setbacks: [[58, 51, 38, 52, -26], [48, 42, 52, 66, -24], [38, 34, 66, 80, -22], [28, 26, 80, 94, -21], [20, 19, 94, 106, -20], [14, 14, 106, 116, -20]] as [number, number, number, number, number][],
  clock: { y0: 116, y1: 121, size: 11, r: 3.6, v: -20 },
  globe: { y: 129, r: 3.5 },
};

/** the Times Square bowtie axis (midline between Broadway and 7th), 42nd -> 47th, from the road centerlines */
export const TIMES_SQUARE_AXIS: [number, number][] = [[-296, -245], [-290, -258], [-260, -340], [-226, -411], [-200, -478], [-169, -552], [-145, -612], [-140, -631]];

/**
 * New York Public Library, Stephen A. Schwarzman Building (1911, Carrère & Hastings). Vermont-marble Beaux-Arts
 * block, 5th Ave between 40th and 42nd. The frame's u axis runs along the 5th Ave front (uptown = +u), v points
 * east toward the avenue; the footprint (BIN 1034194 in the tiles) spans u -58.9..58.9, v -82..0 with the
 * central pavilion projecting to v = 6.3.
 */
export const NYPL = {
  bin: 1034194,
  footprint: [[74.8, -24.9], [102.47, -9.58], [105.32, -8.01], [105.68, -8.65], [115.88, -3.01], [115.55, -2.42], [123.62, 2.04], [124.5, 2.53], [135.95, 8.86], [141.45, 11.91], [145.87, 14.35], [145.92, 14.38], [141.02, 23.2], [125.2, 51.61], [124.59, 52.71], [125.28, 53.09], [130.01, 55.71], [127.42, 60.37], [115.78, 81.28], [110.11, 78.14], [88.42, 117.11], [34.8, 87.44], [17.66, 77.95], [22.92, 68.49], [22.11, 68.04], [27.13, 59.02], [27.48, 59.21], [64.11, -6.6], [63.85, -6.74], [68.85, -15.72], [69.5, -15.37], [73.44, -22.45]] as Ring,
  /** midpoint of the 5th Ave facade line and its bearing (uptown) */
  ox: 117.17,
  oz: 65.75,
  bearing: 29.24,
  /** heights (m above the sidewalk) */
  terrace: 2.0,
  floor: 4.4, // portico / piano nobile floor
  cornice: 21.0, // top of the wings' entablature
  roof: 24.5, // wings' attic top
  pavilionRoof: 25.6,
  /** plaza depth in front of the facade line (the 5th Ave sidewalk starts at v = 28) */
  terraceDepth: 22,
};
/**
 * Grand Central Terminal (1913, Reed & Stem / Warren & Wetmore). BIN 1035381 in the tiles is the terminal
 * building proper (the 85.7 m 42nd St front between Vanderbilt Ave and Depew Place); MetLife abuts it to the
 * north. The south facade is laid out in a Frame at the midpoint of that front (u uptown into the building, v
 * east along the facade): three 18 m round-arched windows in 19 m bays between paired Corinthian columns,
 * the entablature and attic, the Glory of Commerce group with the Tiffany clock. Below the viaduct deck
 * (7 m, matching streets/bridges.ts) the Stony Creek granite ground storey with the entrance arcade.
 */
export const GRAND_CENTRAL = {
  bin: 1035381,
  footprint: [[561.25, 90.53], [532.9, 141.09], [530.81, 139.92], [520.92, 157.56], [446.1, 115.84], [455.85, 98.45], [453.15, 96.94], [485.76, 38.8], [565.35, 83.18], [565.37, 83.19]] as Ring,
  base: 7.4,
  deck: 7.0,
  /** the three great windows: sill, apex, width, bay */
  sill: 12.0,
  apex: 30.0,
  archW: 10.4,
  bay: 19.0,
  /** the paired columns stand on the deck; entablature and cornice heights */
  colTop: 26.6,
  entablature: 28.6,
  cornice: 31.0,
  attic: 35.0,
  roof: 33.5,
  /** the sculpture group (Mercury, Hercules, Minerva) over the centre and its clock */
  sculptureTop: 46.0,
  clock: { y: 38.6, r: 2.0 },
};

/**
 * The Park Avenue Viaduct as tagged in the tiles (bridge, layer 1): the Pershing Square ramp 40th -> 42nd,
 * then two roadways around the terminal (west over Vanderbilt Ave, east over Depew Place) that enter the
 * Helmsley Building's south face through the portals and surface north of it. The streets module already
 * builds the 7 m deck ribbons, ramps and iron railings from these same segments; the landmarks module adds the
 * architecture (granite balustrades, the ramp's arcade walls, the steel arch over 42nd, the terminal terrace)
 * at the same heights. Half-widths per segment are the tiles' road widths / 2 (min 3.2, as the streets do).
 */
export const VIADUCT = {
  deck: 7.0,
  roadY: 0.02,
  center: [505, 90] as [number, number],
  ramp: { pts: [[418.9, 252.6], [472.1, 157.6]] as Ring, hw: 5.19 },
  west: [
    { pts: [[472.1, 157.6], [473.8, 150.8], [474.1, 148.9], [474.2, 147.9], [474.2, 146.9], [474.1, 145.8], [473.8, 144.8], [473.5, 143.9], [473, 143.1], [472.6, 142.4], [471.8, 141.6], [471.1, 140.9], [470.2, 140.4], [449.7, 129.3]] as Ring, hw: 4.17 },
    { pts: [[449.7, 129.3], [444.8, 126.4], [442.5, 124.6], [439.7, 121.9], [438.1, 119.5], [436.9, 116.1], [436.7, 113.1], [436.9, 110], [437.9, 107.1], [438.7, 105], [482, 27.8]] as Ring, hw: 3.33 },
    { pts: [[482, 27.8], [540.4, -77.3], [541.7, -79.3], [543.2, -81], [544.5, -82.2]] as Ring, hw: 5.0 },
  ],
  east: [
    { pts: [[472.1, 157.6], [476.9, 152.5], [478, 151.3], [478.8, 150.5], [479.6, 149.9], [480.6, 149.3], [481.8, 148.8], [483.2, 148.6], [484.5, 148.5], [486.2, 148.8], [487.9, 149.4], [488.6, 149.7], [515.4, 164.2], [517.3, 165], [519.2, 165.2], [520.9, 165.3], [522.8, 165.1], [525.4, 164.5], [527.4, 163.7], [529.6, 162.4], [531.1, 161]] as Ring, hw: 4.13 },
    { pts: [[531.1, 161], [532.8, 157.9], [575.7, 80.5]] as Ring, hw: 3.2 },
    { pts: [[575.7, 80.5], [610.3, 17.4], [615.1, 8.9], [621.5, -2.9]] as Ring, hw: 3.8 },
    { pts: [[621.5, -2.9], [622.5, -4.8], [623.5, -6.9], [624.3, -8.5], [624.9, -11], [625.4, -13.5], [625.9, -16.7], [626, -19.3], [626, -21.1], [625.9, -24.4], [625.7, -27.4], [624.5, -37.6]] as Ring, hw: 3.99 },
  ],
  /** where the roadways enter the Helmsley's south face (deck level) and leave its north face (at grade) */
  helmsleySouth: [[544.5, -82.2], [624.5, -37.6]] as [number, number][],
  helmsleyNorth: [[606.5, -111.4], [629.2, -98.9]] as [number, number][],
};

/** tiles that can contain bowtie facades */
export const TIMES_SQUARE_TILES = new Set(['-2_-1', '-1_-1', '-2_-2', '-1_-2', '-2_-3', '-1_-3']);

export const ONE_WTC = (() => {
  const c = lonLatToXZ(-74.01326, 40.71297);
  return { bins: [1090581, 1086977], cx: c.x, cz: c.z, bearing: 10, base: 61.0, podiumH: 57, roofH: 417, top: 45.7, spireTop: 541 };
})();

export const BROOKLYN_BRIDGE = (() => {
  const mid = lonLatToXZ(-73.99639, 40.70583);
  return { cx: mid.x, cz: mid.z, bearing: 131, halfSpan: 243.2, sideSpan: 283, towerH: 84.3, deckAtTower: 36, deckMid: 41, deckAtAnchor: 27.5, deckW: 26, ramp: 520 };
})();

export const MANHATTAN_BRIDGE = (() => {
  const mid = lonLatToXZ(-73.99066, 40.70718);
  return { cx: mid.x, cz: mid.z, bearing: 136, halfSpan: 224, sideSpan: 221, towerH: 102, deckAtTower: 41, deckMid: 41, deckAtAnchor: 36, deckW: 36.6, ramp: 420 };
})();

export const WILLIAMSBURG_BRIDGE = (() => {
  const mid = lonLatToXZ(-73.97238, 40.71342);
  return { cx: mid.x, cz: mid.z, bearing: 116, halfSpan: 244, sideSpan: 180, towerH: 94.5, deckAtTower: 41, deckMid: 41, deckAtAnchor: 36, deckW: 36, ramp: 380 };
})();

export const WASHINGTON_ARCH = (() => {
  const c = lonLatToXZ(-73.99741, 40.73129);
  return { cx: c.x, cz: c.z, bearing: 29, width: 18.9, depth: 5.5, opening: 9.1, springing: 9.0, atticBase: 16.5, top: 23.4 };
})();

export const LIBERTY = (() => {
  const c = lonLatToXZ(-74.0445, 40.6892);
  return { cx: c.x, cz: c.z, facing: 140 };
})();

/** distance beyond which a landmark is not rendered at all */
export const LANDMARK_CULL_DISTANCE = 6000;

// ---------------------------------------------------------------------------------------------------------
// Midtown skyline towers (footprints from the tiles; local (u, v) = along the avenues uptown / along the
// streets east, about the footprint's vertex centroid, i.e. Frame.fromBearing(centroid, GRID_BEARING))
// ---------------------------------------------------------------------------------------------------------

/** One Vanderbilt (2020): 427 m to the spire; four interlocking tapered volumes, terracotta and glass. */
export const ONE_VANDERBILT = {
  bin: 1090825,
  footprint: [[350.29, 82.23], [380.03, 28.97], [437.38, 60.82], [407.64, 114.07]] as Ring,
  lobby: 18,
  shaft: 250,
  /** the four volumes above the shaft: quadrant (su, sv), top height at the centre, drop toward the outer corner */
  fins: [
    { su: 1, sv: -1, top: 393, drop: 12 },
    { su: 1, sv: 1, top: 352, drop: 14 },
    { su: -1, sv: -1, top: 322, drop: 14 },
    { su: -1, sv: 1, top: 292, drop: 12 },
  ],
  spireTop: 427,
};

/** 432 Park Avenue (2015): 425.5 m; a 28.5 m square of exposed white concrete grid (6 x 6 windows of 3.05 m per face), five open double-height mechanical floors. */
export const FOUR32_PARK = {
  bins: [1088817, 1035787],
  footprint: [[984.35, -904.47], [964.58, -867.85], [979.04, -860.55], [1006.48, -846.47], [995.99, -828.39], [923.06, -868.23], [937.66, -895.06], [943.98, -891.56], [958.91, -918.33]] as Ring,
  cu: 4,
  cv: -12,
  half: 14.25,
  floorH: 4.72,
  bay: 4.75,
  win: 3.05,
  /** first floor index of each two-storey open band */
  openFloors: [26, 38, 50, 62, 74],
  roof: 425.5,
};

/** Citigroup Center (1977): 279 m; the 48 m square tower on four 35 m stilts at the middle of its sides, the 45° roof sloping down to the south. */
export const CITIGROUP = {
  bin: 1036474,
  footprint: [[1104.33, -562.63], [1116.33, -556.07], [1117.43, -558.07], [1170.4, -529.07], [1186.26, -520.39], [1171.42, -493.44], [1154.15, -502.9], [1146.4, -507.14], [1132.06, -481.1], [1104.64, -496.1], [1104.95, -496.65], [1105.73, -498.08], [1072.06, -516.51], [1069.37, -517.99], [1065.21, -520.26], [1067.74, -524.87], [1069.86, -528.72], [1072.76, -533.98], [1075.76, -539.44], [1078.84, -545.03], [1080.29, -547.67], [1080.35, -547.77], [1085.45, -557.04], [1075.03, -562.74], [1073.6, -566.3], [1072.28, -569.57], [1076.65, -577.5], [1077.26, -578.62], [1080.05, -579.27], [1080.41, -579.35], [1085.45, -576.59], [1086.66, -575.93], [1093.74, -572.06], [1093.77, -571.93], [1094.83, -567.83]] as Ring,
  cu: -6,
  cv: -10,
  half: 24,
  stiltH: 35,
  slopeBase: 231,
  top: 279,
};

/** Bank of America Tower (2009): 288 m roof, 366 m spire; a faceted glass crystal on the 6th Ave end of the 42nd-43rd block. */
export const BOFA = {
  bin: 1087268,
  footprint: [[-195.52, -223.43], [-167.32, -273.42], [-149.55, -263.45], [-108.07, -240.19], [-87.6, -228.72], [-54.26, -210.02], [-84.19, -156.96], [-167.94, -203.92], [-187.69, -215], [-185.96, -218.07]] as Ring,
  podium: 40,
  /** tower plan at the podium (u, v) */
  base: [[-31, -49], [30, -49], [30, 32], [-31, 32]] as [number, number][],
  /** crown corners (u, v, y): the plan tapers and the roof falls away from the 6th Ave / 43rd corner */
  crown: [[-31, -44, 268], [30, -49, 288], [24, 26, 262], [-24, 22, 246]] as [number, number, number][],
  spire: [26, -45] as [number, number],
  spireTop: 366,
};

/** The New York Times Building (2007): 228 m roof, 319 m mast; ceramic-rod screen, open rod lattice above the roof. */
export const NYT = {
  bin: 1087186,
  footprint: [[-481.17, -250.15], [-489.37, -235.27], [-493.29, -228.15], [-496.44, -222.44], [-508.03, -201.42], [-508.86, -201.87], [-520.24, -208.11], [-519.61, -209.24], [-524.81, -212.09], [-525.44, -210.96], [-526.04, -209.86], [-549.65, -222.79], [-571.95, -235.01], [-571.57, -235.69], [-567.31, -243.42], [-568.41, -244.02], [-581.3, -251.09], [-585.56, -243.35], [-601.61, -252.14], [-597.85, -258.96], [-610.57, -265.93], [-603.95, -277.93], [-591.91, -299.78], [-588.72, -305.58], [-576.55, -298.91], [-573.98, -303.56], [-558.03, -294.82], [-560.8, -289.8], [-547.27, -282.38], [-546.63, -283.54], [-545.04, -286.43], [-481.45, -251.58], [-481.99, -250.61]] as Ring,
  podium: 28,
  u0: -24, u1: 32, v0: -63, v1: -8,
  roof: 228,
  screen: 16,
  mast: [4, -35.5] as [number, number],
  mastTop: 319,
};

/** MetLife Building (1963): 246 m; the octagonal precast-concrete slab across Park Ave on its 45 m base. The tiles only carry the base. */
export const METLIFE = {
  bin: 1085630,
  footprint: [[541.71, -59.29], [549, -55.24], [576.13, -40.18], [617.75, -17.08], [619.81, -15.94], [619.42, -15.26], [619.53, -15.2], [619.63, -15.14], [620.04, -14.92], [613.96, -4.03], [600.37, 20.32], [587.24, 43.84], [573.53, 68.39], [573.43, 68.33], [573.33, 68.28], [572, 67.54], [568.3, 65.49], [568.09, 65.86], [568.06, 65.92], [565.42, 70.64], [560.79, 78.94], [560.57, 79.33], [560.54, 79.39], [560.29, 79.83], [560.22, 79.96], [560.22, 79.97], [560.17, 79.94], [531.12, 63.82], [501.36, 47.3], [491.34, 41.74], [491.42, 41.61], [499.35, 27.39], [498.78, 27.07], [498.68, 27.02], [495.15, 25.06], [495.16, 25.04], [495.19, 24.99], [495.34, 24.71], [494.49, 24.24], [529.49, -38.47], [540.92, -58.94], [541.37, -58.69]] as Ring,
  base: 45,
  cu: 28,
  cv: -4,
  slab: [[-20, -32], [-12, -40], [12, -40], [20, -32], [20, 32], [12, 40], [-12, 40], [-20, 32]] as [number, number][],
  crown: 232,
  roof: 246,
};

/** Helmsley Building (1929): 172 m to the cupola; the setback tower astride Park Ave with the pyramid roof and gilded lantern. */
export const HELMSLEY = {
  bin: 1036185,
  footprint: [[660.28, -87.04], [654.56, -76.89], [631.1, -35.25], [630.65, -34.46], [624.65, -37.83], [621.9, -39.37], [620.39, -40.21], [620.38, -40.22], [592.38, -55.91], [551.87, -78.6], [541, -84.7], [539.88, -85.32], [544.08, -92.77], [569.51, -137.9], [584.31, -129.61], [608.84, -115.86], [612.31, -113.92], [628.25, -104.99], [635.29, -101.05], [639.56, -98.65], [650.44, -92.56], [659.24, -87.62]] as Ring,
  /** Park Ave axis in the frame */
  cv: -11.5,
  base: 58,
  setback: 82,
  tower: 118,
  pyramid: 146,
  top: 172,
};

/** United Nations Secretariat (1952): 154 m slab, green glass east/west, blank marble ends. */
export const UN = {
  bin: 1083875,
  footprint: [[1305.1, 486.34], [1299.84, 495.76], [1281.18, 529.2], [1280.08, 531.18], [1267.42, 553.85], [1263.14, 561.53], [1251.39, 555.01], [1245.36, 551.66], [1244.81, 551.36], [1248.99, 543.87], [1252.99, 536.71], [1266.95, 511.68], [1267.1, 511.42], [1280.13, 488.08], [1286.77, 476.17], [1301.54, 484.37]] as Ring,
  floorH: 3.95,
  roof: 154,
  /** mechanical floors with louvered grilles */
  louvers: [6, 16, 28],
};

/** 30 Hudson Yards (2019): 387 m, the wedge-topped tower at 33rd & 10th with the Edge deck on the 100th floor; the tiles merge it with the Shops podium. */
export const HY30 = {
  bin: 1088961,
  footprint: [[-1568.79, 40.71], [-1576.62, 36.68], [-1498.59, -83.18], [-1438.66, -52.52], [-1439.29, -51.19], [-1431.14, -47.81], [-1429.41, -49.37], [-1402.11, -33.8], [-1482.39, 107.36], [-1575.08, 55.3], [-1573.57, 53.14], [-1577.72, 50.67]] as Ring,
  podium: 38,
  u0: 10, u1: 76, v0: 0, v1: 66,
  shoulder0: 90,
  shoulder1: 250,
  roofLow: 345,
  roofHigh: 387,
  /** Edge: the triangular deck, 24 m out from the west face */
  deck: [[26, 8.5], [54, 8.5], [40, -16]] as [number, number][],
  deckY: 335,
};

/** 35 Hudson Yards (2019): 308 m, limestone and glass with rounded corners over a wide podium. */
export const HY35 = {
  bin: 1091590,
  footprint: [[-1600.31, -77.04], [-1641.35, -99.84], [-1613.03, -150.08], [-1567.79, -124.4]] as Ring,
  podium: 40,
  setback: 296,
  roof: 308,
};

/** 10 Hudson Yards (2016): 268 m; the tiles tag it 45 m. Sloped roof falling toward 30 Hudson Yards. */
export const HY10 = {
  bin: 1089323,
  footprint: [[-1562.13, 62.47], [-1499.99, 96.83], [-1502.26, 100.92], [-1498.39, 103.06], [-1521.78, 145.04], [-1586.91, 109.08], [-1585.8, 78.28], [-1570.96, 87.78], [-1569.48, 83.57], [-1572.75, 80.47]] as Ring,
  podium: 60,
  u0: -31, u1: 20, v0: -27, v1: 45,
  roofLow: 240,
  roofHigh: 268,
};

/** 55 Hudson Yards (2018): 237 m; the weathered-steel grid over a dark glass base. The tiles tag it 24 m. */
export const HY55 = {
  bin: 1089412,
  footprint: [[-1576.63, -216.11], [-1521.98, -186.35], [-1549.32, -149.97], [-1555.64, -138.87], [-1604.91, -166.1]] as Ring,
  podium: 45,
  u0: -24, u1: 30, v0: -33, v1: 20,
  roof: 237,
};

/**
 * Bryant Park (the spawn / safe zone): the block between 40th and 42nd, 5th and 6th, west of the library's rear
 * wall. Laid out in a Frame whose u axis runs east along the streets (bearing 119, toward 5th Ave) and whose n
 * axis (= -v) points north toward 42nd. The lawn polygon is the tiles' grass; the fountain, kiosks, carousel and
 * cafe pavilions sit on the OSM footprints whose BINs the module claims (list.ts).
 */
export const BRYANT_PARK = {
  ox: 0,
  oz: 0,
  bearing: 119,
  /** world position of the lawn's middle (u = -32, n = 0), used for distance culling */
  center: [-28.0, -15.5] as [number, number],
  lawn: [[-76.5, -27.5], [-76.5, -19], [-63.5, -1.5], [-63.5, 1.5], [-76.5, 19], [-76.5, 27.5], [11.5, 27.5], [11.5, -27.5]] as [number, number][],
  fountain: [-85.8, -0.7] as [number, number],
  kiosks: [[-92.4, -25.7], [-92.5, 23.6]] as [number, number][],
  carousel: [-37.9, -46.2] as [number, number],
  /** the raised terrace at the library's rear (the Grill / Cafe level), u toward the library, n along it */
  terrace: { u0: 31, u1: 53, n0: -56, n1: 56, h: 2.4 },
  cafes: [{ u0: 39.5, u1: 49.8, n0: 15.1, n1: 21.9 }, { u0: 42.5, u1: 50, n0: 25.7, n1: 37.2 }],
  bins: [1091075, 1091074, 1091076, 1090173, 1090169, 1090168],
};
