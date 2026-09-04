/** Weapon ids are stable u8 values used on the wire. 0 = unarmed. */
export const enum WeaponId {
  None = 0,
  Pistol = 1,
  SMG = 2,
  Shotgun = 3,
  Rifle = 4,
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number; // per bullet/pellet
  headshotMultiplier: number;
  range: number; // meters, hitscan max
  roundsPerMinute: number;
  spreadDeg: number; // cone half-angle when hip-firing
  aimSpreadDeg: number;
  pellets: number;
  magazine: number;
  reloadSeconds: number;
  automatic: boolean;
  startingAmmo: number;
}

export const WEAPONS: Record<number, WeaponDef> = {
  [WeaponId.Pistol]: { id: WeaponId.Pistol, name: 'Pistol', damage: 22, headshotMultiplier: 2.0, range: 120, roundsPerMinute: 320, spreadDeg: 1.8, aimSpreadDeg: 0.6, pellets: 1, magazine: 15, reloadSeconds: 1.4, automatic: false, startingAmmo: 60 },
  [WeaponId.SMG]: { id: WeaponId.SMG, name: 'SMG', damage: 14, headshotMultiplier: 1.8, range: 90, roundsPerMinute: 780, spreadDeg: 3.0, aimSpreadDeg: 1.4, pellets: 1, magazine: 30, reloadSeconds: 1.9, automatic: true, startingAmmo: 120 },
  [WeaponId.Shotgun]: { id: WeaponId.Shotgun, name: 'Shotgun', damage: 11, headshotMultiplier: 1.5, range: 32, roundsPerMinute: 70, spreadDeg: 5.5, aimSpreadDeg: 4.0, pellets: 8, magazine: 6, reloadSeconds: 2.6, automatic: false, startingAmmo: 30 },
  [WeaponId.Rifle]: { id: WeaponId.Rifle, name: 'Rifle', damage: 30, headshotMultiplier: 2.2, range: 260, roundsPerMinute: 520, spreadDeg: 2.2, aimSpreadDeg: 0.5, pellets: 1, magazine: 30, reloadSeconds: 2.3, automatic: true, startingAmmo: 90 },
};

export const WEAPON_LIST: WeaponDef[] = Object.values(WEAPONS);
