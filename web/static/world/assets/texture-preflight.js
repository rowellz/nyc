/** Shared street/prop materials may appear on hundreds of meshes. Inspect each
 * material once per render, including late map/uniform changes, without making
 * a property array for every object. Do not cache across frames: textures change. */
export function prepareSceneTextures(scene, prepare) {
  const materials = new Set(), textures = new Set();
  const texture = value => {
    if (value?.isTexture && !textures.has(value)) { textures.add(value); prepare(value); }
  };
  const material = value => {
    if (!value || materials.has(value)) return;
    materials.add(value);
    for (const key in value) {
      if (Object.hasOwn(value, key)) texture(value[key]);
    }
    const uniforms = value.uniforms;
    if (uniforms) for (const key in uniforms) {
      const value = uniforms[key].value;
      if (Array.isArray(value)) { for (const item of value) texture(item); }
      else texture(value);
    }
  };
  scene.traverse(object => {
    if (Array.isArray(object.material)) { for (const item of object.material) material(item); }
    else material(object.material);
  });
}
