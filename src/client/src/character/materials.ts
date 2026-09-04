/**
 * Character materials.
 *  - body: MeshStandardMaterial patched (onBeforeCompile) with a per-instance palette indexed by the
 *    flat `region` vertex attribute (color + roughness per region). All instances share one program.
 *  - protection overlay: additive Fresnel rim (skinned) for spawn-protected players.
 *  - name tags: canvas sprites.
 */
import * as THREE from 'three';
import { registerDynamicTexture } from '@/core/textureRelease';
import { REGION_COUNT, collarCut, type Palette, type BodyParams } from './rig';

const BODY_CACHE_KEY = 'nyc-character-body-v7';

/**
 * Fabric families. The id drives weave scale, fold depth and how much the surface glosses, so a wool
 * topcoat, a nylon puffer, raw denim and a cotton tee stop sharing one plastic-looking surface.
 * 0 cotton  1 wool  2 nylon shell  3 denim  4 leather  5 technical / hi-vis  6 knit or fleece
 */
export const FABRIC = { cotton: 0, wool: 1, nylon: 2, denim: 3, leather: 4, technical: 5, knit: 6 } as const;
export type FabricName = keyof typeof FABRIC;

/** Shared night/sign fill: a frontal ambient term so a crowd under Times Square signs is lit, not a cut-out. */
export interface CharacterUniforms { uTime: { value: number }; uWetness?: { value: number }; uFill?: { value: THREE.Vector4 }; setupMaterial?: (m: THREE.Material) => void }

/** GLSL shared by both character materials: fabric weave, folds and the sign-spill fill. */
const FABRIC_GLSL = `
// weave amplitude + uv scale per fabric family
vec3 fabricWeave(float f, vec2 uv) {
  if (f > 5.5) { // knit / fleece: a chunky rib
    return vec3(sin(uv.x * 84.0) * sin(uv.y * 180.0) * 0.038, 0.085, 0.9);
  } else if (f > 4.5) { // technical / hi-vis: almost flat
    return vec3(sin(uv.x * 240.0) * sin(uv.y * 140.0) * 0.010, 0.02, 1.0);
  } else if (f > 3.5) { // leather: irregular grain
    return vec3(sin(uv.x * 150.0 + sin(uv.y * 61.0) * 2.0) * 0.022, 0.05, 0.7);
  } else if (f > 2.5) { // denim: a diagonal twill
    return vec3(sin(uv.x * 230.0 + uv.y * 140.0) * 0.030, 0.075, 0.55);
  } else if (f > 1.5) { // nylon shell: no weave, crisp small wrinkles
    return vec3(sin(uv.x * 300.0) * sin(uv.y * 190.0) * 0.012, 0.12, 1.35);
  } else if (f > 0.5) { // wool: a soft coarse face
    return vec3(sin(uv.x * 190.0) * sin(uv.y * 108.0) * 0.024, 0.085, 0.8);
  }
  return vec3(sin(uv.x * 200.0) * sin(uv.y * 118.0) * 0.020, 0.05, 1.0); // cotton
}
`;

/** Imported skin keeps texture/normal detail; covered regions use the separate wardrobe.
 * Materials/uniforms are private to the instance; maps and shader programs are shared. */
export function createImportedMaterial(source: THREE.MeshStandardMaterial, palette: Palette, body: Partial<BodyParams>, wetness = { value: 0 }, rim: { value: THREE.Vector4 } = { value: new THREE.Vector4(0, 0, 0, 0) }, fill?: { value: THREE.Vector4 }): THREE.MeshStandardMaterial {
  const m = source.clone();
  m.color.setHex(0xffffff);
  m.side = THREE.FrontSide;
  m.metalness = 0;
  m.roughnessMap = null;
  m.envMapIntensity = 0.7;
  m.vertexColors = false;
  m.customProgramCacheKey = () => 'nyc-imported-human-v7';
  const uFill = fill ?? { value: new THREE.Vector4(0, 0, 0, 0) };
  m.onBeforeCompile = shader => {
    shader.uniforms.uPalette = { value: palette };
    shader.uniforms.uCharWet = wetness;
    shader.uniforms.uRim = rim;
    shader.uniforms.uFill = uFill;
    // x: sleeves 0 short / 1 long / 2 none; y: shorts; z: 0 shirt / 1 open jacket / 2 closed jacket; w: collar height (skin shows above it)
    // the skin starts a few mm inside the closed collar / hem rings of rig.ts so the two meshes overlap, never butt
    shader.uniforms.uGarmentCut = { value: new THREE.Vector4(body.sleeves === 'long' ? 1 : body.sleeves === 'none' ? 2 : 0, body.legs === 'short' ? 1 : 0, body.jacket ? body.jacket === 'open' ? 1 : 2 : 0, collarCut(body)) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 humanRest; attribute vec4 humanParts; varying vec3 vHumanRest; varying vec4 vHumanParts;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHumanRest = humanRest; vHumanParts = humanParts;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vHumanRest; varying vec4 vHumanParts; uniform vec4 uGarmentCut; uniform vec4 uPalette[${REGION_COUNT}]; uniform float uCharWet; uniform vec4 uRim; uniform vec4 uFill;`)
      .replace('#include <map_fragment>', `
        // humanParts = (hand, arm incl. forearm/clavicle, forearm, t along the arm: 0 shoulder, 1 elbow, 2 wrist)
        bool skin = vHumanParts.x > 0.3;
        if (!skin) {
          if (vHumanParts.y > 0.45) {
            // arms: what shows below the sleeve (hems in rig.ts: short at 0.52 of the upper arm, long at 0.88 of the forearm)
            skin = uGarmentCut.x == 2.0 || (uGarmentCut.x == 0.0 && vHumanParts.w > 0.49) || (uGarmentCut.x == 1.0 && vHumanParts.w > 1.85);
          } else {
            float y = vHumanRest.y;
            // neck and head above the collar; the trapezius/upper back stays under the garment
            skin = y > uGarmentCut.w && !(y < 1.545 && (vHumanRest.z > 0.145 || abs(vHumanRest.x) > 0.1));
            // shorts: thigh/shin between the hem (0.61, closed) and the sock
            if (uGarmentCut.y > 0.5 && y > 0.115 && y < 0.625) skin = true;
          }
        }
        if (!skin) discard; // covered by the separate civilian wardrobe
        vec4 paletteColor = uPalette[0];
        vec3 detailColor = vec3(1.0);
        #ifdef USE_MAP
          vec4 sampleColor = texture2D(map, vMapUv);
          // Preserve facial creases/lips without multiplying every skin tone by the dark source complexion.
          detailColor = vec3(clamp(0.55 + 2.0 * dot(sampleColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.40, 1.1));
        #endif
        // subsurface-ish warmth: creases, lips, nostrils and the eye sockets go toward blood red instead of grey
        float crease = clamp((detailColor.r - 0.55) / 0.45, 0.0, 1.0);
        vec3 warm = mix(vec3(1.0, 0.74, 0.68), vec3(1.0), crease);
        diffuseColor.rgb *= paletteColor.rgb * detailColor * warm;
      `)
      // skin: creases matte, the forehead / nose / cheekbones tighter so they take a highlight
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(paletteColor.a - (detailColor.r - 0.85) * 0.35, 0.38, 0.9) * (1.0 - uCharWet * 0.2);')
      // `normal` only exists from <normal_fragment_begin> on, so the view-dependent skin terms live here,
      // still ahead of <lights_physical_fragment>, which is where diffuseColor is consumed.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          // thin parts of the head - ears, the wings of the nose, the jaw edge - carry light through. A
          // Fresnel-weighted red push there is what separates skin from painted plastic at three metres.
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.14, 0.86, 0.79), pow(1.0 - nv, 2.6) * 0.85);
          float rimF = pow(1.0 - nv, 3.0);
          totalEmissiveRadiance += uRim.rgb * (uRim.a * rimF * (0.55 + 0.45 * clamp(normal.y, 0.0, 1.0)));
        }`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        irradiance += uFill.rgb * (uFill.a * (0.34 + 0.66 * clamp(dot(normal, geometryViewDir), 0.0, 1.0)));
        iblIrradiance *= 1.0 + uFill.a * 5.0;`);
  };
  return m;
}

export interface BodyMaterial extends THREE.MeshStandardMaterial {
  userData: { palette: { value: Float32Array }; style: { value: THREE.Vector4 }; fabric: { value: THREE.Vector4 }; wetness?: { value: number }; rim?: { value: THREE.Vector4 } };
}

/**
 * A body material with its own palette. `sharedUniforms` are referenced by identity so the atmosphere
 * module can drive wetness on clothes. `style` flags: x = zip/placket line on the jacket, y = chest graphic
 * on the shirt, z = horizontal stripes on the shirt, w = pocket welts on the jacket. `rim` (rgb, strength) is a
 * view-dependent back light so the local player separates from a dark street at night.
 */
export function createBodyMaterial(palette: Palette, sharedUniforms?: { uWetness?: { value: number }; uFill?: { value: THREE.Vector4 } }, style?: [number, number, number, number], rim?: { value: THREE.Vector4 }, fabric?: [number, number, number, number]): BodyMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.6 }) as BodyMaterial;
  // The procedural weave needs UVs even though the body has no texture maps.
  m.defines = { USE_UV: '' };
  const uPalette = { value: palette };
  const uStyle = { value: new THREE.Vector4(...(style ?? [0, 0, 0, 0])) };
  const uFabric = { value: new THREE.Vector4(...(fabric ?? [0, 0, 0, 0])) };
  const uWet = sharedUniforms?.uWetness ?? { value: 0 };
  const uRim = rim ?? { value: new THREE.Vector4(0, 0, 0, 0) };
  const uFill = sharedUniforms?.uFill ?? { value: new THREE.Vector4(0, 0, 0, 0) };
  m.userData = { palette: uPalette, style: uStyle, fabric: uFabric, wetness: uWet, rim: uRim };
  m.customProgramCacheKey = () => BODY_CACHE_KEY;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPalette = uPalette;
    shader.uniforms.uStyle = uStyle;
    shader.uniforms.uFabric = uFabric;
    shader.uniforms.uCharWet = uWet;
    shader.uniforms.uRim = uRim;
    shader.uniforms.uFill = uFill;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float region;\nflat varying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nflat varying float vRegion;\nuniform vec4 uPalette[${REGION_COUNT}];\nuniform vec4 uStyle;\nuniform vec4 uFabric;\nuniform float uCharWet;\nuniform vec4 uRim;\nuniform vec4 uFill;${FABRIC_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  int rIdx = int(vRegion + 0.5);
  vec4 pal = uPalette[rIdx];
  vec3 col = pal.rgb;
  bool cloth = (rIdx == 1 || rIdx == 2 || rIdx == 8 || rIdx == 12 || rIdx == 15);
  // per-region fabric: the outer layer, the shirt and the trousers each carry their own family
  float fabId = rIdx == 8 ? uFabric.x : rIdx == 2 ? uFabric.z : rIdx == 15 ? 5.0 : rIdx == 12 ? 6.0 : uFabric.y;
  // cloth weave so flat colours do not read as plastic; xyz = (weave, fold depth, wrinkle frequency).
  // Micro-detail only means anything while a garment is more than a few pixels across: fade it out past
  // ~10 m so distant walkers neither shimmer nor pay for six sines a pixel.
  float clothLod = 1.0 - smoothstep(9.0, 24.0, length(vViewPosition));
  vec3 fw = vec3(0.0);
  float weave = 0.0;
  if (cloth && clothLod > 0.01) {
    fw = fabricWeave(fabId, vUv);
    weave = fw.x * clothLod;
  }
  // torso rings carry v = y / 1.8 (0.45..0.95); sleeves are offset to v >= 2 so seams stay on the torso
  bool torso = vUv.y > 0.45 && vUv.y < 0.95;
  float fd = abs(fract(vUv.x - 0.25) - 0.5); // distance (in u) from the front center line at u = 0.75
  if (rIdx == 8 && torso) {
    // An unbuttoned coat: the shirt shows in a smooth V closing at the sternum. rig.ts used to swap the
    // region per ring vertex for this, which quantised the opening into a sawtooth; the lapel strips it
    // still builds sit proud of this wedge, so the front reads as two cloth edges over the shirt.
    if (uStyle.x < 0.5 && vUv.y > 0.585) {
      float vee = 0.088 * smoothstep(0.60, 0.845, vUv.y);
      if (fd < vee) { vec4 palShirt = uPalette[1]; col = palShirt.rgb; }
    }
    if (uStyle.x > 0.5 && fd < 0.0045 && vUv.y > 0.545 && vUv.y < 0.835) col *= 0.5; // zip / placket
    if (uStyle.w > 0.5 && abs(vUv.y - 0.615) < 0.0035 && fd > 0.07 && fd < 0.14) col *= 0.55; // pocket welts
    // seams down the sides
    float sd = min(abs(fract(vUv.x) - 0.0), abs(fract(vUv.x) - 0.5));
    if (sd < 0.003 && vUv.y > 0.55 && vUv.y < 0.8) col *= 0.8;
  }
  if (rIdx == 1 && torso) {
    if (uStyle.z > 0.5) col *= 1.0 - 0.3 * step(0.5, fract(vUv.y * 40.0)); // stripes
    if (uStyle.y > 0.5 && fd < 0.045 && vUv.y > 0.685 && vUv.y < 0.755) col = mix(col, (col.r + col.g + col.b) > 1.2 ? vec3(0.08) : vec3(0.82), 0.85); // chest graphic
  }
  if (rIdx == 8 && vUv.y >= 4.0 && vUv.y < 5.0) {
    // lapel facing (rig.ts strip, u 0 = attached edge, 1 = free edge): a lighter fold catching light, the zip tape dark
    col *= 1.08;
    if (vUv.x > 0.8) col *= 0.45;
  }
  if (rIdx == 8 && vUv.y > 3.2 && vUv.y < 3.5) col *= 0.82; // jacket hem: a darker hem band
  if (rIdx == 2 && vUv.y < 0.95) {
    // jeans: outer / inner seams as a tonal stitch (lighter, so they read on black denim), a worn knee, a hem cuff
    float sd = min(abs(fract(vUv.x) - 0.0), abs(fract(vUv.x) - 0.5));
    if (sd < 0.0055 && vUv.y > 0.05) col = col * 1.7 + 0.018;
    float knee = exp(-pow((vUv.y - 0.5) / 0.045, 2.0)) * (1.0 - min(1.0, abs(fract(vUv.x) - 0.75) / 0.2));
    col *= 1.0 + 0.14 * knee;
    if (vUv.y > 0.885 && vUv.y < 0.9) col *= 0.8;
  }
  if (rIdx == 3) {
    // sneakers: lace stripes across the top (u ~ 0.25), a dark seam line where the upper meets the sole
    float top = 1.0 - min(1.0, abs(fract(vUv.x) - 0.25) / 0.09);
    if (top > 0.0 && vUv.y > 0.925 && vUv.y < 0.975) col *= 0.78 + 0.22 * step(0.5, fract(vUv.y * 80.0));
    if (abs(fract(vUv.x) - 0.75) < 0.16) col *= 0.9; // sole-side shadow line
  }
  if (rIdx == 15) {
    // hi-vis vest: a zip down the front and two retroreflective bands (v 6.0 at the hem .. 6.4 at the shoulder)
    if (fd < 0.006) col *= 0.55;
    float band = min(abs(vUv.y - 6.13), abs(vUv.y - 6.28));
    if (band < 0.021) col = mix(col, vec3(0.60, 0.62, 0.60), 0.92);
  }
  if (rIdx == 8 && uFabric.w > 0.5) {
    // down jacket: horizontal quilt channels about 9 cm apart, a dark seam with a lit tube between
    float q = fract(vUv.y * 20.0);
    float seam = 1.0 - smoothstep(0.0, 0.11, abs(q - 0.5));
    col *= 1.0 - 0.22 * seam;
  }
  if (rIdx == 17) {
    // necktie: a repp stripe running across the blade
    col *= 1.0 - 0.22 * step(0.5, fract((vUv.y * 6.0 + vUv.x) * 5.0));
  }
  diffuseColor.rgb *= col * (1.0 + weave);
  // wet clothes darken and get glossier
  float wetCloth = uCharWet * (cloth || rIdx == 4 || rIdx == 9 ? 0.35 : 0.1);
  diffuseColor.rgb *= 1.0 - wetCloth;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  if (cloth && clothLod > 0.01) {
    // soft folds: low-frequency creases running down the garment plus a little cross-grain, tangent-free (view
    // space). Depth and wrinkle frequency come from the fabric family, so wool drapes and nylon crinkles.
    float wf = fw.z;
    float fold = sin(vUv.y * 210.0 * wf + sin(vUv.x * 29.0) * 2.4) * (0.55 + 0.45 * sin(vUv.x * 63.0 + vUv.y * 17.0));
    float grain = sin(vUv.x * 97.0 * wf + vUv.y * 41.0);
    normal = normalize(normal + vec3(grain * fw.y * 0.6, fold * fw.y, 0.0) * clothLod);
  }
  if (rIdx == 8 && uFabric.w > 0.5) {
    // the quilt channels are tubes, not a printed stripe: bend the normal across each one
    normal = normalize(normal + vec3(0.0, cos(fract(vUv.y * 20.0) * 6.2831) * 0.18, 0.0));
  }`,
      )
      // nylon and leather gloss along the folds; a matte weave stays matte
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(pal.a * (1.0 - uCharWet * 0.4) - (fabId > 1.5 && fabId < 4.5 ? weave * 3.0 : 0.0), 0.06, 1.0);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
    totalEmissiveRadiance += uRim.rgb * (uRim.a * rimF * (0.55 + 0.45 * clamp(normal.y, 0.0, 1.0)));
  }`,
      )
      // sign spill / shop-window fill: a frontal ambient so a night crowd reads as people in coats, not cut-outs.
      // Retroreflective hi-vis bands throw far more of it back than cloth does.
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
  {
    float faceCam = clamp(dot(normal, geometryViewDir), 0.0, 1.0);
    float retro = (rIdx == 15 && min(abs(vUv.y - 6.13), abs(vUv.y - 6.28)) < 0.021) ? 3.4 : 1.0;
    irradiance += uFill.rgb * (uFill.a * retro * (0.34 + 0.66 * faceCam));
    // the city glow itself is the night key light: let the environment probe carry more of it on people
    iblIrradiance *= 1.0 + uFill.a * 5.0;
  }`,
      );
  };
  return m;
}

/** additive Fresnel rim, pulsing light blue: spawn protection */
export function createProtectionMaterial(uTime: { value: number }): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime, uColor: { value: new THREE.Color(0x7fd3ff) }, uStrength: { value: 1 } },
    vertexShader: `
      #include <common>
      #include <skinning_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4(transformed + objectNormal * 0.006, 1.0);
        vN = normalize(normalMatrix * objectNormal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; uniform float uStrength;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
        f = pow(f, 2.2);
        float pulse = 0.65 + 0.35 * sin(uTime * 3.2);
        float scan = 0.85 + 0.15 * sin(gl_FragCoord.y * 0.08 + uTime * 6.0);
        gl_FragColor = vec4(uColor * f * pulse * scan * uStrength * 1.6, f * 0.9);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  return m;
}

// ------------------------------------------------------------------------------------------------
// name tags
// ------------------------------------------------------------------------------------------------

export interface NameTag {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
  set(name: string, score: number): void;
  dispose(): void;
}

const TAG_W = 512, TAG_H = 96;

export function createNameTag(name: string, score: number): NameTag {
  const canvas = document.createElement('canvas');
  canvas.width = TAG_W;
  canvas.height = TAG_H;
  const texture = new THREE.CanvasTexture(canvas);
  registerDynamicTexture(texture, () => canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 10;
  let lastKey = '';
  const draw = (n: string, s: number) => {
    const key = `${n}|${s}`;
    if (key === lastKey) return;
    lastKey = key;
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, TAG_W, TAG_H);
    g.font = '600 44px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const scoreText = s > 0 ? `  ${s.toLocaleString()}` : '';
    g.font = '600 44px "Helvetica Neue", Helvetica, Arial, sans-serif';
    const nameW = g.measureText(n).width;
    g.font = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    const scoreW = g.measureText(scoreText).width;
    const total = nameW + scoreW;
    const x0 = TAG_W / 2 - total / 2;
    // soft pill behind
    g.fillStyle = 'rgba(0,0,0,0.42)';
    roundRect(g, x0 - 22, 18, total + 44, 60, 30);
    g.fill();
    g.font = '600 44px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 6;
    g.fillText(n, x0, TAG_H / 2 + 2);
    if (scoreText) {
      g.font = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
      g.fillStyle = '#ffd166';
      g.fillText(scoreText, x0 + nameW, TAG_H / 2 + 4);
    }
    texture.needsUpdate = true;
  };
  draw(name, score);
  return {
    sprite,
    texture,
    material,
    set: draw,
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// ------------------------------------------------------------------------------------------------
// palettes: NYC street clothing, skin tones, hair
// ------------------------------------------------------------------------------------------------

/**
 * Skin, weighted the way the city is: roughly a third pale European, a quarter Latin American, a fifth
 * African American and a sixth East and South Asian, plus everything in between. The entries repeat to
 * carry the weighting; the shader adds the subsurface warmth on top of whichever one is drawn.
 */
export const SKIN_TONES = [
  0xf1c9a5, 0xf3d4b8, 0xe8b894, 0xe3b48c, 0xecc4a2, // pale to light
  0xd9a276, 0xd0a074, 0xc99a6b, 0xc68642, 0xbe8b58, 0xc79162, // olive / Latin / South Asian
  0xb07a4c, 0xa5673f, 0x9c6238, 0x8d5524, 0x8a5a30, // mid brown
  0x7a4a2a, 0x6b4423, 0x5d3a1e, 0x4a2c17, 0x3a2213, // deep brown
  0xead0b0, 0xe0bE9a, 0xd6b48c, 0xc8a078, // East Asian range
];
export const HAIR_COLORS = [0x1a1210, 0x2b1b12, 0x3d2817, 0x5a3a22, 0x8a5a2b, 0xb08a52, 0xd9c19a, 0x0d0b0a, 0x444444, 0x8a8a8a, 0x2a2420, 0x1a1210, 0x0d0b0a];
/** tees / shirts: NYC reads mostly black, grey, white and navy, with the occasional colour; nothing saturated */
export const TOP_COLORS = [0x141414, 0x1a1a1a, 0x111111, 0x2f2f2f, 0x2f2f2f, 0x8c8c8c, 0x9a9a9a, 0xa9a9a9, 0xe8e6e1, 0xe8e6e1, 0xd9d4c7, 0x1f2a44, 0x27324a, 0x4f5a3a, 0x5e1f24, 0x22382b, 0x4b5f7a, 0xc9b18f, 0xb8862b, 0x9b2226, 0x8fa6bf, 0xd8a0a8, 0x8a7fa8, 0x3a3a3a];
/** outer layers: black dominates, then navy / charcoal / olive / camel / denim */
export const JACKET_COLORS = [0x111111, 0x111111, 0x161616, 0x1a1a1a, 0x2b2b2b, 0x1c2538, 0x1c2538, 0x3b4030, 0xa87d4f, 0xb59a72, 0x3a4a68, 0x4a1a20, 0x243528, 0x6f6f6f, 0x3a2a1e, 0xd8d0bf, 0x2a2f3a];
export const SUIT_COLORS = [0x1a1c22, 0x22262e, 0x1c2538, 0x2d3140, 0x3a3a3a, 0x4a4a4a];
export const PANTS_COLORS = [0x1a1a1a, 0x101010, 0x22252a, 0x2b2b2b, 0x3a3a3a, 0x5a5048, 0x8a7a66, 0xa8977a, 0x232833, 0x2f2a26, 0x4a4a38, 0x5c5c5c, 0x3b3f33, 0x6b5a45];
/** jeans: raw indigo to washed */
export const DENIM_COLORS = [0x161c2a, 0x1c2536, 0x22304a, 0x2c3a5a, 0x2e3a52, 0x3c4a66, 0x455a80, 0x4b5670, 0x5c6b85];
export const SHOE_COLORS = [0xe6e6e6, 0xe6e6e6, 0xdcdcdc, 0x111111, 0x111111, 0x0d0d0d, 0x222222, 0x4a3222, 0x5a3a22, 0x8a8a8a, 0x223046, 0xbbbbbb];
export const BAG_COLORS = [0x141414, 0x1e1e1e, 0x2a2622, 0x3a2a1e, 0x1e2838, 0x3c3f36, 0x555555, 0x6b4a2a, 0x8a1f24];
/** topcoats: camel and charcoal read as wool at a distance where black just reads as a hole */
export const COAT_COLORS = [0x1a1a1a, 0x24262a, 0x2f3138, 0x1c2538, 0x3b4030, 0x8a6a3f, 0xa07c4c, 0x6b6257, 0x4a4a4a, 0x2a2f2a, 0x4a2a26, 0x8a8478];
/** tights under a skirt: opaque black dominates, then charcoal, navy and bare-leg nude */
export const TIGHTS_COLORS = [0x141416, 0x1a1a1c, 0x111113, 0x2a2a2e, 0x22262e, 0xb08a68, 0x8a6a50, 0x3a3a3e];
export const HAT_COLORS = [0x111111, 0x1a1a1a, 0x1c2538, 0x8a8a8a, 0x5e1f24, 0xd9d4c7, 0x3b4030, 0x27324a];

let seed = 12345;
export function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}
export function randomPaletteColors(): { skin: number; shirt: number; pants: number; shoes: number; hair: number; accent: number } {
  return { skin: pick(SKIN_TONES), shirt: pick(TOP_COLORS), pants: pick(PANTS_COLORS), shoes: pick(SHOE_COLORS), hair: pick(HAIR_COLORS), accent: pick([0x1a1612, 0x2b2620, 0x3a2f28, 0x141414]) };
}
