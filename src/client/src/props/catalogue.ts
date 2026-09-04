import * as THREE from 'three';
import { packMesh, type PackedMesh } from '../buildings/transfer';
import { buildLamp } from './kinds/lamp';
import { buildSignal, buildPedHead, buildSignalCabinet } from './kinds/signal';
import * as signs from './kinds/signs';
import * as small from './kinds/small';
import * as furniture from './kinds/furniture';
import { buildShedBay, buildShedEnd, buildShedNet, buildShedPost } from './kinds/scaffolding';
import { buildFireEscapeLanding, buildFireEscapeLadder } from './kinds/fireEscape';
import { buildSubwayRailing, buildStairwellQuad } from './kinds/subway';
import * as cafe from './kinds/cafe';
import * as litter from './kinds/litter';

export interface PropKind {
  name: string; geometry: PackedMesh; far: PackedMesh | null;
  material: 'base' | 'mapped' | 'plywood' | 'mesh' | 'shrub' | 'ped' | 'glass' | 'stairwell';
  range: number; opts: { radius?: number; castShadow?: boolean; castShadowDistance?: number; dynamic?: boolean };
}
/** The unchanged authored geometry catalogue, evaluated only in the worker. */
export function buildCatalogue(shadows: boolean): PropKind[] {
  const kinds: PropKind[] = [];
  const register = (name: string, geometry: THREE.BufferGeometry, material: PropKind['material'] = 'base',
    range = 180, far: THREE.BufferGeometry | null = null, opts: PropKind['opts'] = {}) => {
    kinds.push({ name, geometry: packMesh(geometry), far: far ? packMesh(far) : null, material, range, opts });
  };
  const sidewalkShadow = { castShadow: shadows, castShadowDistance: 60 };
  // These fixed faces now live in the atlas's portrait strip. Adapt their older rotated-slot UVs.
  const portrait = (g: THREE.BufferGeometry, fraction: number) => {
    const uv = g.getAttribute('uv'), style = g.getAttribute('aMat'), normal = g.getAttribute('normal');
    for (let i = 0; i < uv.count; i++) if (style.getZ(i) > 0.5 && Math.abs(normal.getZ(i)) > 0.99) {
      const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, 1 - u / fraction);
    }
    return g;
  };
  const mirror = (g: THREE.BufferGeometry) => {
    g.scale(-1, 1, 1);
    const index = g.index;
    if (index) for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i); index.setX(i, index.getX(i + 2)); index.setX(i + 2, a);
    }
    return g;
  };
  register('lamp', buildLamp('near'), 'base', 160, buildLamp('far'), { radius: 12, castShadow: shadows });
  register('lampLED', buildLamp('near', true), 'base', 160, buildLamp('far', true), { radius: 12, castShadow: shadows });
  register('signal', buildSignal('near'), 'base', 150, buildSignal('far'), { radius: 11, dynamic: true, castShadow: shadows });
  register('pedHead', buildPedHead(), 'ped', 150, null, { dynamic: true });
  register('signalCabinet', buildSignalCabinet());
  register('streetBlade', signs.buildStreetBlade(), 'mapped', 220);
  register('signPost', signs.buildSignPost(), 'mapped', 220, null, sidewalkShadow);
  register('regSign', portrait(signs.buildRegSign(), (0.457 / 0.305) * (64 / 384)), 'mapped', 180, null, sidewalkShadow);
  register('oneWay', signs.buildOneWay(), 'mapped');
  const stop = signs.buildStopSign();
  const stopUV = stop.getAttribute('uv');
  for (let i = 0; i < stopUV.count; i++) stopUV.setX(i, stopUV.getX(i) * 6);
  register('stopSign', stop, 'mapped');
  register('muni', portrait(signs.buildMuniMeter(), 0.5), 'mapped', 180, null, sidewalkShadow);
  register('hydrant', small.buildHydrant('black'), 'base', 180, null, sidewalkShadow);
  register('hydrantRed', small.buildHydrant('red'), 'base', 180, null, sidewalkShadow);
  register('wireBasket', small.buildWireBasket(true), 'mesh');
  register('steelBasket', small.buildSteelBasket());
  // Small soft collection piles: one city-wide draw; no stale daytime shadow/collider.
  register('trash_bags', small.buildTrashBags(), 'base', 110, null, { radius: 1.6, castShadow: false });
  register('bollard', small.buildBollard(), 'base', 180, null, sidewalkShadow);
  register('bikeRack', small.buildBikeRack(), 'base', 180, null, sidewalkShadow);
  register('bench', small.buildBench());
  register('mailbox', small.buildMailbox());
  register('planter', small.buildPlanter(), 'base', 180, null, sidewalkShadow);
  register('shrub', small.buildShrub(), 'shrub', 180, null, sidewalkShadow);
  register('globe', small.buildGlobeLamp(), 'base', 180, null, sidewalkShadow);
  register('shed', buildShedBay('near'), 'plywood', 150, buildShedBay('far'), { radius: 7, castShadow: shadows });
  register('shedEnd', buildShedEnd(), 'plywood', 375, null, { radius: 7, ...sidewalkShadow });
  register('shedPost', buildShedPost(), 'plywood', 150, null, { radius: 5 });
  register('shedNet', buildShedNet(), 'mesh', 150, null, { radius: 7 });
  register('escapeBase', buildFireEscapeLanding('near', false), 'base', 140, buildFireEscapeLanding('far', false));
  register('escapeStair', buildFireEscapeLanding('near', true), 'base', 140, buildFireEscapeLanding('far', true), { radius: 6 });
  register('escapeReverse', mirror(buildFireEscapeLanding('near', true)), 'base', 140, mirror(buildFireEscapeLanding('far', true)), { radius: 6 });
  register('escapeLadder', buildFireEscapeLadder(), 'base', 160, null, { radius: 5 });
  register('subway', buildSubwayRailing('near'), 'mapped', 150, buildSubwayRailing('far'), { radius: 5, ...sidewalkShadow });
  // The generic renderer accepts any material, including the author's unlit parallax shader.
  register('stairwell', buildStairwellQuad(), 'stairwell', 280, null, sidewalkShadow);
  register('busShelter', furniture.buildBusShelter(), 'mapped', 240, null, { castShadow: shadows });
  register('shelterGlass', furniture.buildShelterGlass(), 'glass', 180);
  register('busSign', furniture.buildBusSignPlate(false), 'mapped', 220);
  register('citiBike', furniture.buildCitiDock(true), 'base', 150);
  register('citiEmpty', furniture.buildCitiDock(false), 'base', 200);
  register('citiKiosk', furniture.buildCitiKiosk(), 'mapped', 200);
  register('link', furniture.buildLinkNYC(), 'mapped', 220);
  register('newsstand', furniture.buildNewsstand(), 'mapped', 250, null, { castShadow: shadows });
  register('foodCart', furniture.buildFoodCart(), 'mapped', 200, null, { castShadow: shadows });
  register('stack', furniture.buildConEdStack(), 'base', 250, null, { radius: 6 });
  // sidewalk cafe and planted things (kinds/cafe.ts); umbrellas and tables throw the long 18:00 shadows
  register('cafeTable', cafe.buildCafeTable(), 'base', 120, null, { radius: 1.2, castShadow: shadows });
  register('umbrellaCream', cafe.buildCafeUmbrella('cream'), 'base', 160, null, { radius: 2.4, castShadow: shadows });
  register('umbrellaGreen', cafe.buildCafeUmbrella('green'), 'base', 160, null, { radius: 2.4, castShadow: shadows });
  register('cafePlanter', cafe.buildCafePlanter(), 'base', 120, null, { castShadow: shadows });
  register('sandwichBoard', cafe.buildSandwichBoard(), 'base', 90);
  register('flowerBox', cafe.buildFlowerBox(0), 'base', 110);
  register('flowerBox2', cafe.buildFlowerBox(1), 'base', 110);
  register('escapePlants', cafe.buildEscapePlants(), 'base', 90, null, { radius: 2 });
  // storefront-awning hardware over the canvas the buildings module bakes (kinds/cafe.ts): the scalloped
  // hem and the rafter frame, both casting so the awning stops reading as one unsupported plane.
  register('awningHem', cafe.buildAwningHem(), 'base', 110, null, { radius: 1.2, castShadow: shadows });
  register('awningRig', cafe.buildAwningRig(), 'base', 130, null, { radius: 1.6, castShadow: shadows });
  // the small-scale litter layer (kinds/litter.ts): bagged trash at the curb, news racks, locked bikes,
  // and the iron guards on the tree pits environment/trees.ts leaves bare.
  register('trashPile', litter.buildTrashPile(), 'base', 110, null, { radius: 1.4, castShadow: shadows });
  register('newsRack', litter.buildNewsRack(), 'base', 110, null, { radius: 1.1 });
  register('bikeLocked', litter.buildLockedBike(), 'base', 100, null, { radius: 1.2 });
  register('treeGuard', litter.buildTreeGuard(), 'base', 95, null, { radius: 1.6 });

  return kinds;
}
