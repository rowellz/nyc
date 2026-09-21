/** Weld ribbon joins before splitting the road mesh into physics chunks.
 * Keep the original triangles: independently rounding polygon cuts to Float32
 * opens hairline gaps, especially where a lane meets an angled junction. */
export function resolveRoadCollision(out) {
  const positions = [], indices = [], vertices = new Map(), faces = new Set();
  for (let i = 0; i < out.cidx.length; i += 3) {
    const face = out.cidx.slice(i, i + 3).map(v => out.cpos.slice(v * 3, v * 3 + 3).map(Math.fround));
    const [a, b, c] = face, u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
    if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) < 1e-10) continue;
    const ids = face.map(p => {
      const key = p.join(',');
      if (!vertices.has(key)) { vertices.set(key, positions.length / 3); positions.push(...p); }
      return vertices.get(key);
    });
    // Rotations represent the same oriented face; an underside must keep its
    // opposite winding even if it happens to share the top's three vertices.
    const start = ids.indexOf(Math.min(...ids));
    const key = [ids[start], ids[(start + 1) % 3], ids[(start + 2) % 3]].join(',');
    if (faces.has(key)) continue;
    faces.add(key); indices.push(...ids);
  }
  out.cpos = positions; out.cidx = indices;
}
