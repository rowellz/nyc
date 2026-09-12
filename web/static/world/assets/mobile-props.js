/** Mobile street furniture: cached placement, worker clearance and staged GPU updates. */
export function createMobileProps(ctx, deps) {
  const { Group, Material, InstancedMesh, Matrix4, Quaternion, Vector3, SignalNetwork,
    nearestProps, geometryFor, streetLampPlacement, tileKey, tileIndex, buildScope } = deps;
  const group = new Group(); group.name = 'props'; ctx.worldGroup.add(group);
  const material = new Material({ vertexColors: true, roughness: 0.85 });
  const pools = new Map(), builds = buildScope(ctx), cache = new WeakMap();
  const stats = { instances: 0, capacity: 200 };
  const quaternion = new Quaternion(), position = new Vector3(), up = new Vector3(0, 1, 0), scale = new Vector3(1, 1, 1);
  let network = new SignalNetwork(), revision = 0, workerRevision = -1, serial = 0;
  let worker, pending, disposed = false, dirty = true, lastX = Infinity, lastZ = Infinity, next = 0;
  let selection = new Set();
  const changed = () => { revision++; dirty = true; };
  const off = [ctx.events.on('tileLoaded', changed), ctx.events.on('tileUnloaded', changed)];

  function fail() {
    worker?.terminate(); worker = undefined; workerRevision = -1;
    pending?.job.cancel(); pending = undefined; dirty = true;
  }
  try {
    // Carry the entry revision into the static worker URL as well.
    worker = new Worker(new URL('./mobile-props.worker.js' + new URL(import.meta.url).search, import.meta.url), { type: 'module', name: 'mobile-props' });
    worker.onerror = event => { event.preventDefault(); fail(); };
    worker.onmessageerror = fail;
    worker.onmessage = ({ data }) => {
      if (!pending || data.id !== pending.id || disposed) return;
      if (data.error) { console.warn('[mobile-props] placement worker failed', data.error); fail(); return; }
      const request = pending;
      if (request.revision !== revision) { request.job.cancel(); pending = undefined; return; }
      for (let i = 0; i < request.missing.length; i++) cache.set(request.missing[i], { revision, prop: data.placements[i] });
      request.job.run(commit(request));
    };
  } catch { worker = undefined; }

  function* commit(request) {
    let complete = false;
    try {
      const kinds = new Map(), signals = new SignalNetwork();
      for (const source of request.sources) {
        if (disposed || request.revision !== revision) return;
        let entry = cache.get(source);
        if (entry?.revision !== revision) {
          entry = { revision, prop: streetLampPlacement(ctx.world, undefined, source) };
          cache.set(source, entry);
        }
        const prop = entry.prop;
        if (prop) {
          entry.height ??= ctx.physics.groundHeight(prop.x, prop.z);
          position.set(prop.x, entry.height, prop.z);
          quaternion.setFromAxisAngle(up, prop.yaw);
          const matrix = new Matrix4().compose(position, quaternion, scale);
          if (!kinds.has(prop.kind)) kinds.set(prop.kind, []);
          kinds.get(prop.kind).push(matrix);
          if (prop.kind === 'traffic_signal') signals.addPole(prop.x, prop.z, prop.yaw, tileKey(tileIndex(prop.x), tileIndex(prop.z)));
        }
        // Ground queries, signals and matrix preparation share the scene budget.
        yield;
      }
      for (const [kind, matrices] of kinds) {
        if (disposed || request.revision !== revision) return;
        let mesh = pools.get(kind);
        const capacity = Math.ceil(matrices.length / 16) * 16;
        if (!mesh || mesh.instanceMatrix.count < matrices.length || mesh.instanceMatrix.count > capacity + 32) {
          const geometry = mesh?.geometry ?? geometryFor(kind);
          if (mesh) { group.remove(mesh); mesh.dispose(); }
          mesh = new InstancedMesh(geometry, material, capacity);
          mesh.name = `ios-props-${kind}`; mesh.castShadow = false; mesh.frustumCulled = false;
          group.add(mesh); pools.set(kind, mesh);
        }
        mesh.count = matrices.length;
        matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        yield;
      }
      if (disposed || request.revision !== revision) return;
      for (const [kind, mesh] of pools) if (!kinds.has(kind)) {
        group.remove(mesh); mesh.dispose(); mesh.geometry.dispose(); pools.delete(kind);
      }
      network = signals; selection = new Set(request.sources);
      stats.instances = [...kinds.values()].reduce((n, list) => n + list.length, 0);
      complete = true;
    } finally {
      if (pending === request) pending = undefined;
      dirty = !complete || request.revision !== revision;
    }
  }

  function refresh() {
    if (pending || disposed) return;
    const camera = ctx.camera.position;
    const sources = nearestProps(ctx.world.tiles.values(), camera.x, camera.z, stats.capacity);
    lastX = camera.x; lastZ = camera.z;
    // Distance sorting changes while walking even when membership does not.
    if (!dirty && sources.length === selection.size && sources.every(p => selection.has(p))) return;
    const missing = sources.filter(source => cache.get(source)?.revision !== revision);
    const request = { id: ++serial, revision, sources, missing, job: builds.job('mobile props') };
    pending = request;
    if (!worker || !missing.length) { request.job.run(commit(request)); return; }
    const message = { id: request.id, props: missing };
    if (workerRevision !== revision) {
      message.tiles = [...ctx.world.tiles.values()].map(({ key, tx, tz, roads, buildings, water }) =>
        ({ key, tx, tz, roads, buildings: buildings.map(b => ({ footprint: b.footprint })), water }));
      workerRevision = revision;
    }
    try { worker.postMessage(message); } catch { fail(); }
  }
  refresh();
  return { name: 'props', stats,
    signalFor: (x, z, dx, dz) => network.signalFor(x, z, dx, dz, ctx.state.serverTime()),
    update(_dt, t) {
      if (disposed || t < next) return;
      next = t + 0.5;
      if (dirty || (ctx.camera.position.x - lastX) ** 2 + (ctx.camera.position.z - lastZ) ** 2 > 4) refresh();
    },
    dispose() {
      disposed = true; off.forEach(fn => fn()); worker?.terminate(); builds.dispose(); pending = undefined;
      for (const mesh of pools.values()) { mesh.dispose(); mesh.geometry.dispose(); }
      pools.clear(); selection.clear(); group.clear(); ctx.worldGroup.remove(group); material.dispose();
    },
  };
}
