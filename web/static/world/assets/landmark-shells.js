// Architectural massing shared by nearby building batches and both scenery tiers.
// Dimensions/frame match src/client/src/landmarks/build/esb.ts and data.ts.
// Keep the silhouette even when the detailed landmark loses its mobile slot.
export function landmarkShell(id, footprint) {
  if (id !== 1015862) return null;
  const bearing = 209 * Math.PI / 180, U = 60.2;
  const world = (u, v) => [-132.6 + Math.sin(bearing) * u + Math.cos(bearing) * v,
    577.4 - Math.cos(bearing) * u + Math.sin(bearing) * v];
  // Positive x/z winding, as required by the ordinary building baker.
  const ring = points => points.map(([u, v]) => world(u, v));
  const rect = (u0, u1, v0, v1) => ring([[u0,v0],[u1,v0],[u1,v1],[u0,v1]]);
  const cross = (a, b) => {
    const [u0,u1,v0,v1] = a, [s0,s1,t0,t1] = b;
    return ring([[u0,v0],[s0,v0],[s0,t0],[s1,t0],[s1,v0],[u1,v0],
      [u1,v1],[s1,v1],[s1,t1],[s0,t1],[s0,v1],[u0,v1]]);
  };
  const circle = radius => ring(Array.from({length:8}, (_,i) =>
    [U/2 + Math.cos(i*Math.PI/4)*radius, 49 + Math.sin(i*Math.PI/4)*radius]));
  const tiers = [];
  const add = (ring, base, top, metal = false) => tiers.push({ring, holes:[], base, top, metal});
  add(footprint, 0, 24);
  add(rect(3,U-3,4.5,118), 24, 79);
  add(rect(6,U-6,8,102), 79, 97);
  add(rect(9,U-9,12,88), 97, 115);
  add(cross([8,U-8,28,70],[12,U-12,18,80]), 115, 269);
  add(cross([11,U-11,32,66],[15,U-15,22,76]), 269, 302);
  add(cross([14,U-14,36,62],[18,U-18,28,70]), 302, 318);
  add(rect(19,U-19,31,67), 318, 322.5);
  // Four small steps approximate the tapered mooring mast without facade fins.
  for (let i=0;i<4;i++) {
    const t=i/3, u=6.6-1.4*t, v=9-2.8*t, bevel=2.6-.6*t;
    add(ring([[U/2-u+bevel,49-v],[U/2+u-bevel,49-v],
      [U/2+u,49-v+bevel],[U/2+u,49+v-bevel],
      [U/2+u-bevel,49+v],[U/2-u+bevel,49+v],
      [U/2-u,49+v-bevel],[U/2-u,49-v+bevel]]),
    322.5+i*10.875, 322.5+(i+1)*10.875);
  }
  add(circle(5.2),366,371.5,true);
  add(circle(4.3),371.5,376);
  add(circle(2.55),376,381);
  add(circle(1.5),381,400,true);
  add(circle(1.1),400,425,true);
  add(circle(.7),425,443.2,true);
  return tiers;
}
