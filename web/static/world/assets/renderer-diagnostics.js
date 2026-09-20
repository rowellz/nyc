/** Sampled by the existing five-second iOS diagnostic beacon, never per frame.
 * These are resident scene attribute bytes, not a measurement of Safari's heap
 * or GPU allocation. Shared/interleaved buffers are counted only once.
 */
export function rendererDiagnostics(ctx) {
  const buffers = new Set(), groups = new Map();
  const roots = (ctx.scene?.children ?? []).flatMap(root => root === ctx.worldGroup ? root.children : [root]);
  for (const root of roots) {
    let bytes = 0;
    const add = attribute => {
      const buffer = (attribute?.data?.array ?? attribute?.array)?.buffer;
      if (buffer && !buffers.has(buffer)) { buffers.add(buffer); bytes += buffer.byteLength; }
    };
    root.traverse(object => {
      const geometry = object.geometry;
      if (geometry) {
        for (const attribute of Object.values(geometry.attributes ?? {})) add(attribute);
        add(geometry.index);
      }
      add(object.instanceMatrix); add(object.instanceColor);
    });
    if (bytes) groups.set(root.name || root.type || 'unnamed', (groups.get(root.name || root.type || 'unnamed') ?? 0) + bytes);
  }
  return {
    revision: new URL(import.meta.url).searchParams.get('v'),
    quality: ctx.quality?.level, ios: ctx.world?.ios === true,
    position: ctx.camera?.position ? ['x', 'y', 'z'].map(axis => Math.round(ctx.camera.position[axis])) : null,
    tiles: ctx.world?.tiles?.size ?? 0,
    calls: ctx.renderer?.info?.render?.calls ?? 0,
    triangles: ctx.renderer?.info?.render?.triangles ?? 0,
    sceneBufferBytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0),
    sceneBuffersByGroup: [...groups].sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
}
