/**
 * Procedural weapon + pickup prop meshes. Dimensions are the real firearms (meters):
 *   Pistol  — Glock 19 Gen5: 187 mm long, 128 mm tall, 34 mm wide, 102 mm barrel, polymer frame / nDLC steel slide
 *   SMG     — H&K MP5A3: 700 mm with the stock out, 225 mm barrel, stamped-steel receiver, curved 30-rd mag
 *   Shotgun — Mossberg 500 (18.5"): ~1000 mm, aluminium receiver, walnut corncob forend + stock, 5+1 tube
 *   Rifle   — M4-pattern AR (16"): ~840-890 mm, flat-top upper, M-LOK handguard, A2 flash hider, red dot
 * Every gun is one merged geometry (single draw call with the shared weapon material). Named points:
 * 'muzzle' (bore exit), 'eject' (ejection port, right side). Space: -Z forward, +Y up, origin = firing hand.
 */
import * as THREE from 'three';
import { WeaponId } from '@shared/weapons';
import type { GameContext } from '@/core/context';
import { GunBuilder, M, deg } from './gunBuilder';
import { getWeaponMaterial } from './materials';
import { scheduleInit, finishNow } from './init';
import { prepareWeaponTextures } from './textures';

export interface WeaponMeshInfo {
  geometry: THREE.BufferGeometry;
  muzzle: THREE.Vector3;
  eject: THREE.Vector3;
  /** shell kind for ejection visuals */
  shell: 'pistol' | 'rifle' | 'shotgun';
  tris: number;
  /** overall length (for pickups / labels) */
  length: number;
  /** detachable magazine (own mesh, same material) so a reload can slide it out and back */
  mag?: THREE.BufferGeometry;
}

function* pistol(): Generator<void, WeaponMeshInfo, unknown> {
  const b = new GunBuilder();
  // ---- slide (nDLC steel) with chamfered top edges
  b.box(0.0255, 0.027, 0.174, M.slide, { pos: [0, 0.0415, -0.067] }, 0.0032, 2);
  yield;
  // rear cocking serrations (5 raised ridges read as cuts from arm's length)
  for (let i = 0; i < 5; i++) b.box(0.0268, 0.015, 0.0012, M.steel, { pos: [0, 0.041, 0.004 + i * 0.0032] });
  yield;
  // front serrations (Gen5)
  for (let i = 0; i < 4; i++) b.box(0.0268, 0.013, 0.0012, M.steel, { pos: [0, 0.040, -0.128 - i * 0.0032] });
  yield;
  // ejection port (right) + extractor
  b.box(0.0035, 0.011, 0.024, M.black, { pos: [0.0122, 0.048, -0.095] });
  yield;
  b.box(0.0015, 0.004, 0.012, M.steelBright, { pos: [0.0128, 0.046, -0.078] });
  yield;
  // sights
  b.box(0.0032, 0.0045, 0.005, M.steelDark, { pos: [0, 0.0572, -0.145] });
  yield;
  b.box(0.0012, 0.0012, 0.0012, M.whitePlastic, { pos: [0, 0.058, -0.1476] }); // front white dot
  yield;
  b.box(0.019, 0.0045, 0.0065, M.steelDark, { pos: [0, 0.0572, 0.009] });
  yield;
  b.box(0.0035, 0.0046, 0.002, M.black, { pos: [0, 0.0575, 0.0115] }); // rear notch
  yield;
  // barrel at the muzzle + bore
  b.cyl(0.0056, 0.0056, 0.008, M.steelBright, { pos: [0, 0.0445, -0.152] }, 'z', 12);
  yield;
  b.disc(0.0044, M.black, { pos: [0, 0.0445, -0.1562], rot: [0, Math.PI, 0] }, 'z', 12);
  yield;
  // ---- polymer frame: rail block under the slide, lower frame around the trigger, dust cover rail
  b.box(0.0275, 0.017, 0.158, M.polymer, { pos: [0, 0.0205, -0.061] }, 0.002, 1);
  yield;
  b.box(0.0265, 0.013, 0.078, M.polymer, { pos: [0, 0.0065, -0.036] }, 0.002, 1);
  yield;
  b.box(0.0215, 0.0055, 0.032, M.polymer, { pos: [0, 0.0095, -0.118] }, 0.001, 1); // accessory rail
  yield;
  for (let i = 0; i < 3; i++) b.box(0.0222, 0.002, 0.0025, M.polymerDark, { pos: [0, 0.007, -0.108 - i * 0.0075] });
  yield;
  // grip (Gen5: no finger grooves), raked back 17°
  b.box(0.031, 0.092, 0.050, M.polymer, { pos: [0, -0.039, 0.006], rot: [deg(-17), 0, 0] }, 0.009, 2);
  yield;
  // stipple panels slightly proud of the grip sides (reads as texture change)
  b.box(0.0325, 0.052, 0.036, M.polymerDark, { pos: [0, -0.046, 0.004], rot: [deg(-17), 0, 0] }, 0.004, 1);
  yield;
  // beavertail
  b.box(0.026, 0.008, 0.020, M.polymer, { pos: [0, 0.008, 0.030], rot: [deg(10), 0, 0] }, 0.003, 1);
  yield;
  // trigger guard (front bar + bottom bar) and trigger with safety blade
  b.box(0.013, 0.030, 0.0075, M.polymer, { pos: [0, -0.009, -0.0745], rot: [deg(-8), 0, 0] }, 0.002, 1);
  yield;
  b.box(0.013, 0.0065, 0.056, M.polymer, { pos: [0, -0.0225, -0.047] }, 0.002, 1);
  yield;
  b.box(0.0065, 0.019, 0.004, M.polymerDark, { pos: [0, -0.008, -0.040], rot: [deg(-12), 0, 0] });
  yield;
  // magazine (hidden inside the grip until a reload pulls it) + base plate (follows the grip angle), slightly proud
  const mg = new GunBuilder();
  mg.box(0.022, 0.09, 0.03, M.magSteel, { pos: [0, -0.042, 0.008], rot: [deg(-17), 0, 0] }, 0.002, 1);
  mg.box(0.0335, 0.0085, 0.056, M.polymerDark, { pos: [0, -0.0845, 0.0195], rot: [deg(-17), 0, 0] }, 0.002, 1);
  yield;
  // controls: slide stop (left), takedown lever (left), mag release (left)
  b.box(0.0035, 0.004, 0.014, M.steelDark, { pos: [-0.0145, 0.030, -0.030] });
  yield;
  b.box(0.003, 0.003, 0.012, M.steelDark, { pos: [-0.0145, 0.023, -0.070] });
  yield;
  b.box(0.004, 0.006, 0.006, M.polymerDark, { pos: [-0.0165, -0.006, -0.028] });
  yield;
  // pins
  b.cyl(0.002, 0.002, 0.030, M.steelBright, { pos: [0, 0.017, -0.024] }, 'x', 8);
  yield;
  b.cyl(0.002, 0.002, 0.030, M.steelBright, { pos: [0, 0.017, -0.070] }, 'x', 8);
  yield;
  b.point('muzzle', 0, 0.0445, -0.157).point('eject', 0.016, 0.052, -0.095);
  yield;
  const r = b.build();
  const mr = mg.build();
  return { geometry: r.geometry, mag: mr.geometry, muzzle: r.points.get('muzzle')!, eject: r.points.get('eject')!, shell: 'pistol', tris: r.tris + mr.tris, length: 0.187 };
}

function* smg(): Generator<void, WeaponMeshInfo, unknown> {
  const b = new GunBuilder();
  // ---- lower / trigger group (polymer)
  b.box(0.040, 0.038, 0.135, M.polymer, { pos: [0, 0.038, -0.035] }, 0.006, 2);
  yield;
  // pistol grip
  b.box(0.032, 0.095, 0.042, M.polymer, { pos: [0, -0.030, 0.010], rot: [deg(-15), 0, 0] }, 0.008, 2);
  yield;
  // trigger guard + trigger + selector
  b.box(0.012, 0.006, 0.050, M.polymer, { pos: [0, 0.004, -0.056] }, 0.002, 1);
  yield;
  b.box(0.012, 0.022, 0.006, M.polymer, { pos: [0, 0.013, -0.081] }, 0.002, 1);
  yield;
  b.box(0.007, 0.018, 0.004, M.steelDark, { pos: [0, 0.012, -0.053], rot: [deg(-10), 0, 0] });
  yield;
  b.box(0.003, 0.005, 0.022, M.polymerDark, { pos: [-0.0215, 0.046, -0.004] });
  yield;
  b.cyl(0.006, 0.006, 0.003, M.polymerDark, { pos: [-0.0215, 0.046, 0.004] }, 'x', 10);
  yield;
  // ---- receiver (stamped steel) + top rib
  b.box(0.046, 0.050, 0.300, M.steel, { pos: [0, 0.082, -0.120] }, 0.009, 2);
  yield;
  b.box(0.020, 0.009, 0.285, M.steelDark, { pos: [0, 0.1115, -0.120] }, 0.002, 1);
  yield;
  // ejection port (right)
  b.box(0.003, 0.015, 0.028, M.black, { pos: [0.0235, 0.088, -0.155] });
  yield;
  // cocking tube (over the barrel), front cap, cocking handle (left)
  b.cyl(0.0145, 0.0145, 0.215, M.steel, { pos: [0, 0.114, -0.3775] }, 'z', 14);
  yield;
  b.cyl(0.0125, 0.0105, 0.010, M.steelDark, { pos: [0, 0.114, -0.490] }, 'z', 12);
  yield;
  b.cyl(0.0055, 0.0055, 0.028, M.steelDark, { pos: [-0.024, 0.114, -0.440] }, 'x', 8);
  yield;
  b.box(0.012, 0.014, 0.010, M.polymerDark, { pos: [-0.037, 0.114, -0.440] }, 0.003, 1);
  yield;
  // barrel, tri-lug muzzle, bore
  b.cyl(0.0095, 0.0095, 0.230, M.parkerized, { pos: [0, 0.085, -0.380] }, 'z', 12);
  yield;
  b.cyl(0.0125, 0.0125, 0.026, M.steelDark, { pos: [0, 0.085, -0.503] }, 'z', 12);
  yield;
  b.torus(0.0095, 0.0025, M.steel, { pos: [0, 0.085, -0.509] }, 5, 12);
  yield;
  b.disc(0.0075, M.black, { pos: [0, 0.085, -0.5165], rot: [0, Math.PI, 0] }, 'z', 12);
  yield;
  // handguard (slim polymer) with 6 ventilation slots per side
  b.box(0.044, 0.050, 0.185, M.polymer, { pos: [0, 0.080, -0.366] }, 0.010, 2);
  yield;
  for (let i = 0; i < 6; i++) {
    b.box(0.002, 0.018, 0.010, M.black, { pos: [0.0225, 0.078, -0.300 - i * 0.026] });
  yield;
    b.box(0.002, 0.018, 0.010, M.black, { pos: [-0.0225, 0.078, -0.300 - i * 0.026] });
  yield;
  }
  // magazine well + curved 30-round magazine + floor plate + paddle release
  b.box(0.042, 0.032, 0.056, M.steel, { pos: [0, 0.044, -0.165] }, 0.003, 1);
  yield;
  const mg = new GunBuilder();
  mg.curvedStack([0, 0.028, -0.165], 4, 0.048, deg(8), 0.021, 0.037, M.magSteel, 0.002);
  yield;
  const end = mg.points.get('stackEnd')!;
  mg.box(0.024, 0.006, 0.041, M.polymerDark, { pos: [end.x, end.y - 0.002, end.z], rot: [deg(-8 * 4), 0, 0] }, 0.001, 1);
  yield;
  b.box(0.030, 0.014, 0.016, M.polymerDark, { pos: [0, 0.028, -0.128], rot: [deg(20), 0, 0] }, 0.002, 1);
  yield;
  // sights: rear rotary drum, front hooded post
  b.cyl(0.013, 0.013, 0.018, M.steelDark, { pos: [0, 0.129, 0.004] }, 'z', 14);
  yield;
  b.box(0.004, 0.006, 0.006, M.steelDark, { pos: [0, 0.140, -0.004] });
  yield;
  b.torus(0.0115, 0.0018, M.steelDark, { pos: [0, 0.136, -0.470] }, 5, 16);
  yield;
  b.box(0.0016, 0.012, 0.0016, M.steelDark, { pos: [0, 0.130, -0.470] });
  yield;
  b.box(0.012, 0.006, 0.014, M.steelDark, { pos: [0, 0.121, -0.470] });
  yield;
  // A3 retractable stock: two rails + polymer butt
  b.box(0.010, 0.012, 0.190, M.steelDark, { pos: [0.0175, 0.083, 0.125] }, 0.002, 1);
  yield;
  b.box(0.010, 0.012, 0.190, M.steelDark, { pos: [-0.0175, 0.083, 0.125] }, 0.002, 1);
  yield;
  b.box(0.050, 0.115, 0.024, M.polymer, { pos: [0, 0.060, 0.231] }, 0.006, 2);
  yield;
  b.box(0.046, 0.108, 0.006, M.rubber, { pos: [0, 0.060, 0.245] }, 0.002, 1);
  yield;
  b.point('muzzle', 0, 0.085, -0.517).point('eject', 0.030, 0.092, -0.155);
  yield;
  const r = b.build();
  const mr = mg.build();
  return { geometry: r.geometry, mag: mr.geometry, muzzle: r.points.get('muzzle')!, eject: r.points.get('eject')!, shell: 'pistol', tris: r.tris + mr.tris, length: 0.76 };
}

function* shotgun(): Generator<void, WeaponMeshInfo, unknown> {
  const b = new GunBuilder();
  // ---- receiver (anodized aluminium), port, tang safety
  b.box(0.040, 0.062, 0.185, M.anodized, { pos: [0, 0.045, -0.115] }, 0.007, 2);
  yield;
  b.box(0.003, 0.021, 0.058, M.black, { pos: [0.0205, 0.049, -0.100] });
  yield;
  b.box(0.012, 0.005, 0.020, M.polymerDark, { pos: [0, 0.0785, -0.045] }, 0.001, 1);
  yield;
  b.box(0.008, 0.004, 0.008, M.polymer, { pos: [0, 0.0825, -0.041] }, 0.001, 1);
  yield;
  // barrel (parkerized), muzzle bore, bead, barrel band + clamp
  b.cyl(0.0115, 0.0115, 0.470, M.parkerized, { pos: [0, 0.065, -0.4425] }, 'z', 14);
  yield;
  b.disc(0.0093, M.black, { pos: [0, 0.065, -0.6781], rot: [0, Math.PI, 0] }, 'z', 12);
  yield;
  b.sphere(0.0025, M.brass, { pos: [0, 0.0785, -0.664] }, 6);
  yield;
  b.cyl(0.014, 0.014, 0.012, M.parkerized, { pos: [0, 0.065, -0.600] }, 'z', 14);
  yield;
  b.box(0.012, 0.030, 0.012, M.parkerized, { pos: [0, 0.050, -0.600] }, 0.001, 1);
  yield;
  // magazine tube + cap
  b.cyl(0.0125, 0.0125, 0.400, M.parkerized, { pos: [0, 0.036, -0.4075] }, 'z', 14);
  yield;
  b.cyl(0.0135, 0.0125, 0.014, M.steelDark, { pos: [0, 0.036, -0.612] }, 'z', 14);
  yield;
  // action bars (steel) from the forend into the receiver
  b.box(0.004, 0.010, 0.120, M.steelBright, { pos: [0.0185, 0.045, -0.270] });
  yield;
  b.box(0.004, 0.010, 0.120, M.steelBright, { pos: [-0.0185, 0.045, -0.270] });
  yield;
  // walnut corncob forend: body + 9 rings
  b.box(0.048, 0.046, 0.185, M.wood, { pos: [0, 0.037, -0.370] }, 0.013, 2);
  yield;
  for (let i = 0; i < 9; i++) b.box(0.0505, 0.0485, 0.0016, M.wood, { pos: [0, 0.037, -0.300 - i * 0.0175] }, 0.0005, 1);
  yield;
  // trigger guard housing (polymer), guard, trigger, safety
  b.box(0.030, 0.012, 0.095, M.polymerDark, { pos: [0, 0.010, -0.072] }, 0.003, 1);
  yield;
  b.box(0.014, 0.006, 0.075, M.polymerDark, { pos: [0, 0.0005, -0.070] }, 0.002, 1);
  yield;
  b.box(0.014, 0.016, 0.006, M.polymerDark, { pos: [0, 0.008, -0.106] }, 0.002, 1);
  yield;
  b.box(0.006, 0.016, 0.004, M.steelBright, { pos: [0, 0.008, -0.056], rot: [deg(-10), 0, 0] });
  yield;
  // walnut stock: wrist -> comb -> butt (side profile, 40 mm wide, rounded edges)
  b.profile(
    [
      [-0.025, 0.070],
      [0.090, 0.066],
      [0.300, 0.050],
      [0.318, 0.038],
      [0.332, -0.072],
      [0.318, -0.086],
      [0.170, -0.046],
      [0.055, -0.018],
      [-0.025, 0.010],
    ],
    0.040,
    M.wood,
    0.007,
  );
  // recoil pad (rubber) on the butt, following its angle
  b.box(0.042, 0.128, 0.022, M.rubber, { pos: [0, -0.020, 0.335], rot: [deg(6), 0, 0] }, 0.005, 2);
  yield;
  // sling swivel studs
  b.cyl(0.003, 0.003, 0.006, M.steelBright, { pos: [0, -0.070, 0.240] }, 'y', 8);
  yield;
  b.cyl(0.003, 0.003, 0.006, M.steelBright, { pos: [0, 0.020, -0.612] }, 'y', 8);
  yield;
  b.point('muzzle', 0, 0.065, -0.679).point('eject', 0.028, 0.050, -0.100);
  yield;
  // hand point: the stock wrist, ~30 mm behind the receiver and 35 mm up
  const r = b.build([0, -0.035, -0.030]);
  return { geometry: r.geometry, muzzle: r.points.get('muzzle')!, eject: r.points.get('eject')!, shell: 'shotgun', tris: r.tris, length: 1.02 };
}

function* rifle(): Generator<void, WeaponMeshInfo, unknown> {
  const b = new GunBuilder();
  // ---- lower receiver + magwell
  b.box(0.032, 0.046, 0.190, M.anodized, { pos: [0, 0.035, -0.060] }, 0.004, 2);
  yield;
  b.box(0.034, 0.056, 0.072, M.anodized, { pos: [0, -0.001, -0.115] }, 0.003, 1);
  yield;
  // controls: selector, bolt catch (left), mag release (right), takedown pins
  b.box(0.003, 0.005, 0.024, M.anodizedGrey, { pos: [-0.0175, 0.046, -0.004] });
  yield;
  b.cyl(0.005, 0.005, 0.003, M.anodizedGrey, { pos: [-0.0175, 0.046, 0.006] }, 'x', 10);
  yield;
  b.box(0.003, 0.014, 0.012, M.anodizedGrey, { pos: [-0.0175, 0.040, -0.090] });
  yield;
  b.cyl(0.004, 0.004, 0.005, M.anodizedGrey, { pos: [0.0185, 0.040, -0.083] }, 'x', 10);
  yield;
  b.cyl(0.0025, 0.0025, 0.036, M.steelBright, { pos: [0, 0.022, -0.155] }, 'x', 8);
  yield;
  b.cyl(0.0025, 0.0025, 0.036, M.steelBright, { pos: [0, 0.050, 0.020] }, 'x', 8);
  yield;
  // trigger guard + trigger
  b.box(0.012, 0.005, 0.052, M.anodized, { pos: [0, 0.000, -0.046] }, 0.001, 1);
  yield;
  b.box(0.012, 0.016, 0.005, M.anodized, { pos: [0, 0.006, -0.073] }, 0.001, 1);
  yield;
  b.box(0.006, 0.017, 0.004, M.steelBright, { pos: [0, 0.006, -0.046], rot: [deg(-10), 0, 0] });
  yield;
  // A2 pistol grip (raked 22°) with a slight palm swell
  b.box(0.031, 0.095, 0.045, M.polymer, { pos: [0, -0.036, 0.013], rot: [deg(-22), 0, 0] }, 0.008, 2);
  yield;
  b.box(0.034, 0.030, 0.040, M.polymer, { pos: [0, -0.070, 0.024], rot: [deg(-22), 0, 0] }, 0.008, 1);
  yield;
  // STANAG 30-round magazine (aluminium) + floor plate
  const mg = new GunBuilder();
  mg.curvedStack([0, -0.028, -0.115], 3, 0.062, deg(5), 0.024, 0.058, M.anodizedGrey, 0.002);
  yield;
  const end = mg.points.get('stackEnd')!;
  mg.box(0.027, 0.007, 0.062, M.polymerDark, { pos: [end.x, end.y - 0.002, end.z], rot: [deg(-15), 0, 0] }, 0.001, 1);
  yield;
  // ---- upper receiver, rail with slots, ejection port + deflector + forward assist, charging handle
  b.box(0.032, 0.040, 0.200, M.anodized, { pos: [0, 0.078, -0.070] }, 0.005, 2);
  yield;
  b.box(0.021, 0.010, 0.190, M.anodized, { pos: [0, 0.103, -0.070] }, 0.001, 1);
  yield;
  for (let i = 0; i < 14; i++) b.box(0.0222, 0.0045, 0.0045, M.black, { pos: [0, 0.1065, 0.017 - i * 0.0128] });
  yield;
  b.box(0.003, 0.018, 0.052, M.black, { pos: [0.0165, 0.078, -0.105] });
  yield;
  b.box(0.0025, 0.020, 0.054, M.anodized, { pos: [0.0162, 0.067, -0.105] }); // dust cover (closed)
  yield;
  b.box(0.010, 0.022, 0.012, M.anodized, { pos: [0.019, 0.080, -0.068] }, 0.002, 1); // brass deflector
  yield;
  b.cyl(0.0065, 0.0065, 0.014, M.anodized, { pos: [0.021, 0.083, -0.046] }, 'z', 10); // forward assist
  yield;
  b.box(0.010, 0.008, 0.032, M.anodized, { pos: [0, 0.096, 0.036] }, 0.001, 1);
  yield;
  b.box(0.044, 0.006, 0.009, M.anodized, { pos: [0, 0.095, 0.048] }, 0.001, 1);
  yield;
  // ---- buffer tube, castle nut, collapsible stock (side profile), butt pad
  b.cyl(0.0155, 0.0155, 0.180, M.anodized, { pos: [0, 0.080, 0.120] }, 'z', 12);
  yield;
  b.cyl(0.020, 0.020, 0.008, M.anodized, { pos: [0, 0.080, 0.036] }, 'z', 12);
  yield;
  b.profile(
    [
      [0.070, 0.102],
      [0.240, 0.100],
      [0.252, 0.088],
      [0.256, -0.018],
      [0.244, -0.030],
      [0.205, -0.028],
      [0.110, 0.042],
      [0.070, 0.048],
    ],
    0.038,
    M.polymer,
    0.004,
  );
  b.box(0.036, 0.120, 0.006, M.rubber, { pos: [0, 0.036, 0.259] }, 0.002, 1);
  yield;
  // ---- M-LOK free-float handguard (octagonal) + top rail + slots; barrel; A2 flash hider
  b.cyl(0.019, 0.019, 0.330, M.anodized, { pos: [0, 0.082, -0.335] }, 'z', 8);
  yield;
  b.box(0.021, 0.010, 0.330, M.anodized, { pos: [0, 0.103, -0.335] }, 0.001, 1);
  yield;
  for (let i = 0; i < 13; i++) b.box(0.0222, 0.0045, 0.0045, M.black, { pos: [0, 0.1065, -0.185 - i * 0.025] });
  yield;
  for (let i = 0; i < 6; i++) {
    const z = -0.215 - i * 0.045;
    b.box(0.002, 0.007, 0.032, M.black, { pos: [0.0185, 0.082, z] });
  yield;
    b.box(0.002, 0.007, 0.032, M.black, { pos: [-0.0185, 0.082, z] });
  yield;
    b.box(0.007, 0.002, 0.032, M.black, { pos: [0, 0.0635, z] });
  yield;
  }
  b.cyl(0.0085, 0.0085, 0.082, M.parkerized, { pos: [0, 0.082, -0.541] }, 'z', 12);
  yield;
  b.cyl(0.011, 0.011, 0.057, M.parkerized, { pos: [0, 0.082, -0.6085] }, 'z', 12);
  yield;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    b.box(0.0025, 0.004, 0.030, M.black, { pos: [Math.cos(a) * 0.0105, 0.082 + Math.sin(a) * 0.0105, -0.612], rot: [0, 0, a - Math.PI / 2] });
  yield;
  }
  b.disc(0.0062, M.black, { pos: [0, 0.082, -0.6371], rot: [0, Math.PI, 0] }, 'z', 12);
  yield;
  // folded flip-up sights (front on the handguard, rear on the receiver)
  b.box(0.018, 0.010, 0.030, M.anodized, { pos: [0, 0.113, -0.475] }, 0.002, 1);
  yield;
  b.box(0.026, 0.010, 0.030, M.anodized, { pos: [0, 0.113, -0.010] }, 0.002, 1);
  yield;
  // red dot sight (T2-style) on a lower-1/3 mount
  b.box(0.030, 0.026, 0.048, M.anodized, { pos: [0, 0.121, -0.095] }, 0.003, 1);
  yield;
  b.cyl(0.0155, 0.0155, 0.064, M.anodized, { pos: [0, 0.149, -0.095] }, 'z', 14);
  yield;
  b.torus(0.0135, 0.002, M.anodized, { pos: [0, 0.149, -0.128] }, 5, 16);
  yield;
  b.disc(0.0125, M.lens, { pos: [0, 0.149, -0.1275], rot: [0, Math.PI, 0] }, 'z', 14);
  yield;
  b.disc(0.0125, M.lens, { pos: [0, 0.149, -0.0625] }, 'z', 14);
  yield;
  b.box(0.012, 0.010, 0.020, M.anodized, { pos: [0, 0.163, -0.088] }, 0.002, 1);
  yield;
  b.cyl(0.006, 0.006, 0.006, M.anodizedGrey, { pos: [0.017, 0.149, -0.095] }, 'x', 10);
  yield;
  b.point('muzzle', 0, 0.082, -0.638).point('eject', 0.026, 0.084, -0.105);
  yield;
  const r = b.build();
  const mr = mg.build();
  return { geometry: r.geometry, mag: mr.geometry, muzzle: r.points.get('muzzle')!, eject: r.points.get('eject')!, shell: 'rifle', tris: r.tris + mr.tris, length: 0.90 };
}

/** classic hard-shell first-aid case: 300 x 120 x 220 mm white with a red cross, handle on top */
export function* buildMedkitGeometrySteps(): Generator<void, { geometry: THREE.BufferGeometry; tris: number }, unknown> {
  const b = new GunBuilder();
  b.box(0.30, 0.115, 0.22, M.whitePlastic, { pos: [0, 0.0575, 0] }, 0.012, 2);
  yield;
  b.box(0.302, 0.004, 0.222, M.polymerDark, { pos: [0, 0.062, 0] }, 0.001, 1); // seam
  yield;
  b.box(0.06, 0.017, 0.15, M.redPlastic, { pos: [0, 0.114, 0] }, 0.002, 1); // cross on the lid
  yield;
  b.box(0.15, 0.017, 0.06, M.redPlastic, { pos: [0, 0.114, 0] }, 0.002, 1);
  yield;
  b.box(0.04, 0.12, 0.012, M.redPlastic, { pos: [0.151, 0.0575, 0] }, 0.002, 1); // side crosses
  yield;
  b.box(0.04, 0.04, 0.012, M.redPlastic, { pos: [0.151, 0.0575, 0] }, 0.002, 1);
  yield;
  b.box(0.012, 0.12, 0.04, M.redPlastic, { pos: [-0.151, 0.0575, 0] }, 0.002, 1);
  yield;
  b.box(0.012, 0.04, 0.12, M.redPlastic, { pos: [-0.151, 0.0575, 0] }, 0.002, 1);
  yield;
  b.box(0.11, 0.02, 0.022, M.polymerDark, { pos: [0, 0.128, 0.07] }, 0.006, 2); // handle
  yield;
  b.box(0.02, 0.02, 0.02, M.polymerDark, { pos: [-0.05, 0.12, 0.07] }, 0.004, 1);
  yield;
  b.box(0.02, 0.02, 0.02, M.polymerDark, { pos: [0.05, 0.12, 0.07] }, 0.004, 1);
  yield;
  b.box(0.03, 0.02, 0.014, M.steelBright, { pos: [0.11, 0.062, 0.113] }, 0.002, 1); // latches
  yield;
  b.box(0.03, 0.02, 0.014, M.steelBright, { pos: [-0.11, 0.062, 0.113] }, 0.002, 1);
  yield;
  const r = b.build();
  return { geometry: r.geometry, tris: r.tris };
}

/** plate carrier: front/back plates, cummerbund, shoulder straps, two mag pouches, standing upright */
export function* buildVestGeometrySteps(): Generator<void, { geometry: THREE.BufferGeometry; tris: number }, unknown> {
  const b = new GunBuilder();
  const nylon = M.nylon;
  b.box(0.30, 0.34, 0.035, nylon, { pos: [0, 0.20, 0.09] }, 0.02, 2); // front plate bag
  yield;
  b.box(0.30, 0.34, 0.035, nylon, { pos: [0, 0.20, -0.09] }, 0.02, 2); // back
  yield;
  b.box(0.36, 0.14, 0.20, nylon, { pos: [0, 0.12, 0] }, 0.03, 2); // cummerbund
  yield;
  b.box(0.07, 0.045, 0.20, nylon, { pos: [0.10, 0.385, 0] }, 0.012, 2); // shoulder straps
  yield;
  b.box(0.07, 0.045, 0.20, nylon, { pos: [-0.10, 0.385, 0] }, 0.012, 2);
  yield;
  b.box(0.075, 0.14, 0.05, M.nylonCoyote, { pos: [-0.06, 0.13, 0.135] }, 0.008, 1); // pouches
  yield;
  b.box(0.075, 0.14, 0.05, M.nylonCoyote, { pos: [0.06, 0.13, 0.135] }, 0.008, 1);
  yield;
  for (let i = 0; i < 5; i++) b.box(0.26, 0.006, 0.004, M.nylonCoyote, { pos: [0, 0.24 + i * 0.03, 0.109] }); // MOLLE rows
  yield;
  b.box(0.08, 0.03, 0.006, M.whitePlastic, { pos: [0, 0.335, 0.11] }, 0.002, 1); // patch
  yield;
  const r = b.build();
  return { geometry: r.geometry, tris: r.tris };
}

const cache = new Map<number, WeaponMeshInfo>();
export function weaponInfo(id: number): WeaponMeshInfo | null {
  return cache.get(id) ?? null;
}
const pending = new Map<number, Promise<void>>();
let weaponAbort = new AbortController();
export function prepareWeapon(ctx: GameContext, id: number): Promise<void> {
  if (cache.has(id)) return Promise.resolve();
  const existing = pending.get(id);
  if (existing) return existing;
  const recipe = ({ [WeaponId.Pistol]: pistol, [WeaponId.SMG]: smg, [WeaponId.Shotgun]: shotgun, [WeaponId.Rifle]: rifle })[id];
  if (!recipe) return Promise.resolve();
  // Cache becomes visible only after both the material and geometry are ready.
  const signal = weaponAbort.signal;
  const job = (async () => {
    await prepareWeaponTextures(ctx, id === WeaponId.Shotgun, signal);
    await scheduleInit(ctx, (function* () {
      const info = yield* recipe();
      yield;
      getWeaponMaterial(ctx, id === WeaponId.Shotgun);
      cache.set(id, info);
    })(), signal);
  })().finally(() => { if (pending.get(id) === job) pending.delete(id); });
  pending.set(id, job);
  return job;
}

/** A renderable weapon: a Group with the merged mesh and 'muzzle' / 'eject' locator children. */
export function buildWeaponMesh(ctx: GameContext, id: number): THREE.Group | null {
  const info = weaponInfo(id);
  if (!info) return null;
  const g = new THREE.Group();
  g.name = `weapon-${id}`;
  const mesh = new THREE.Mesh(info.geometry, getWeaponMaterial(ctx, id === WeaponId.Shotgun));
  mesh.name = 'body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  g.add(mesh);
  if (info.mag) {
    const mag = new THREE.Mesh(info.mag, mesh.material);
    mag.name = 'mag';
    mag.castShadow = true;
    mag.receiveShadow = true;
    g.add(mag);
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.copy(info.muzzle);
  g.add(muzzle);
  const eject = new THREE.Object3D();
  eject.name = 'eject';
  eject.position.copy(info.eject);
  g.add(eject);
  g.userData.weaponId = id;
  g.userData.shell = info.shell;
  g.userData.length = info.length;
  return g;
}

export function disposeWeaponGeometries(): void {
  weaponAbort.abort();
  pending.clear();
  for (const i of cache.values()) {
    i.geometry.dispose();
    i.mag?.dispose();
  }
  cache.clear();
  weaponAbort = new AbortController();
}

export function buildMedkitGeometry(): { geometry: THREE.BufferGeometry; tris: number } {
  return finishNow(buildMedkitGeometrySteps());
}

export function buildVestGeometry(): { geometry: THREE.BufferGeometry; tris: number } {
  return finishNow(buildVestGeometrySteps());
}
