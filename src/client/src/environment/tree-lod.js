/** Tree scenery shares the detailed renderer's species, textures and instance transforms. */
export function treeBudget(quality, ios = false) {
  const mobile = quality.level === 'mobile';
  return { distance: Math.min(quality.farDistance ?? 2000, ios ? 800 : mobile ? 1200 : 2000),
    middle: ios ? 150 : mobile ? 220 : 320, count: ios ? 2000 : mobile ? 4000 : 10000 };
}

export function syncSceneryTrees(ctx, trees, records) {
  const tiles = ctx.worldGroup.userData.sceneryTreeTiles;
  let changed = false;
  for (const [key, value] of records) if (tiles?.get(key) !== value.source) {
    records.delete(key); changed = true;
  }
  if (tiles) for (const [key, tile] of tiles) if (!records.has(key)) {
    trees.addTile(tile, true);
    records.get(key).source = tile;
    changed = true;
  }
  return changed;
}

export function treeRecords(near, far, camera, distance, limit) {
  const visible = [];
  const collect = records => {
    for (const record of records) {
      const d2 = (record.tree.x-camera.x)**2 + (record.tree.z-camera.z)**2;
      if (d2 <= distance*distance) visible.push({ record, d2 });
    }
  };
  for (const records of near.values()) collect(records);
  for (const [key, records] of far) if (!near.has(key)) collect(records);
  if (visible.length > limit) { visible.sort((a,b)=>a.d2-b.d2); visible.length=limit; }
  return visible.map(v=>v.record);
}

/** A subset of the actual leaf clusters, plus a low-poly trunk and overhead crown cards. */
export function treeLods(proto, spec, THREE, merge) {
  const indices = proto.leaves.index.array, clusters = indices.length / 18;
  const count = Math.min(40, clusters), chosen = [];
  for (let i=0;i<count;i++) {
    const first=Math.floor((i+.5)*clusters/count)*18;
    chosen.push(...indices.slice(first,first+18));
  }
  const subset=proto.leaves.clone(); subset.setIndex(chosen);
  const middle=subset.toNonIndexed(); subset.dispose();
  const position=middle.attributes.position, off=middle.attributes.aCardOff;
  // Slightly fuller clusters preserve crown coverage after thinning the leaves.
  for(let i=0;i<position.count;i++) {
    position.setXYZ(i,position.getX(i)+off.getX(i)*.35,position.getY(i)+off.getY(i)*.35,position.getZ(i)+off.getZ(i)*.35);
    off.setXYZ(i,off.getX(i)*1.35,off.getY(i)*1.35,off.getZ(i)*1.35);
  }
  const height=spec.bot+.12;
  const wood=new THREE.CylinderGeometry(.011,.019,height,5);
  wood.translate(0,height*.5,0);
  const cards=[proto.far], cy=(spec.top+spec.bot)/2;
  for(const offset of [-.15,.18]) {
    const card=new THREE.PlaneGeometry(spec.width*.98,spec.width*.98);
    card.rotateX(-Math.PI/2); card.translate(0,cy+(spec.top-spec.bot)*offset,0);
    const leaf=new Float32Array(12);
    for(let i=0;i<4;i++)leaf.set([.8,.5+offset,0],i*3);
    card.setAttribute('aLeaf',new THREE.BufferAttribute(leaf,3));
    card.setAttribute('aCardOff',new THREE.BufferAttribute(new Float32Array(12),3));
    cards.push(card);
  }
  return {middle,wood,far:merge(cards)};
}
