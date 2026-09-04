/**
 * Vehicle materials. One MeshPhysicalMaterial per kind for everything opaque (smooth clearcoated paint,
 * plastics, rubber, chrome, lenses, plates, liveries) driven by per-vertex aMat / aLight and
 * per-instance light + wheel attributes; one dark tinted glass material. Both extend three's materials via
 * onBeforeCompile so CSM shadows, fog and env reflections from the atmosphere module apply.
 */
import * as THREE from 'three';
import { R, type KindAtlas } from './atlas';

export interface VehicleUniforms {
  uNight: { value: number };
  uTime: { value: number };
  uWet: { value: number };
}

/** shared attribute names on InstancedMesh */
export const INST_ATTR = { lightA: 'iLightA', lightB: 'iLightB', wheel: 'iWheel', susp: 'iSusp' } as const;

const VERT_PARS = /* glsl */ `
attribute vec4 aMat;
attribute float aLight;
attribute vec4 aWheel;
#ifdef USE_INSTANCING
attribute vec4 iLightA;
attribute vec4 iLightB;
attribute vec4 iWheel;
attribute vec4 iSusp;
#endif
varying vec4 vMat;
varying float vLight;
varying vec4 vLightA;
varying vec4 vLightB;
varying vec3 vLocal;
`;

const VERT_NORMAL = /* glsl */ `
vec3 objectNormal = vec3( normal );
mat3 wheelRot = mat3( 1.0 );
vec3 wheelOff = vec3( 0.0 );
#ifdef USE_INSTANCING
if ( aWheel.w > 0.5 ) {
  float spin = iWheel.x;
  float steer = ( aWheel.w < 2.5 ) ? iWheel.y : 0.0;
  float cs = cos( spin ), ss = sin( spin );
  mat3 rx = mat3( 1.0, 0.0, 0.0, 0.0, cs, ss, 0.0, -ss, cs );
  float cy = cos( steer ), sy = sin( steer );
  mat3 ry = mat3( cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy );
  wheelRot = ry * rx;
  int wi = int( aWheel.w + 0.5 ) - 1;
  wheelOff.y = ( wi == 0 ) ? iSusp.x : ( wi == 1 ) ? iSusp.y : ( wi == 2 ) ? iSusp.z : iSusp.w;
  objectNormal = wheelRot * objectNormal;
}
#endif
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

const VERT_BEGIN = /* glsl */ `
vec3 transformed = vec3( position );
#ifdef USE_INSTANCING
if ( aWheel.w > 0.5 ) transformed = aWheel.xyz + wheelRot * ( position - aWheel.xyz ) + wheelOff;
vLightA = iLightA;
vLightB = iLightB;
#else
vLightA = vec4( 0.0 );
vLightB = vec4( 0.0 );
#endif
vLocal = transformed;
vMat = aMat;
vLight = aLight;
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vMat;
varying float vLight;
varying vec4 vLightA;
varying vec4 vLightB;
varying vec3 vLocal;
uniform float uNight;
uniform float uTime;
uniform float uWet;
uniform float uSeed;
uniform vec4 uHeadlightRect;
uniform vec4 uHeadlightDisc;
float vblink( float phase ) { return step( 0.5, fract( uTime * 1.4 + phase ) ); }
`;

/** emissive per light channel; iLightA = (head, brake, sigL, sigR), iLightB = (siren, reverse, roofSign, blinkPhase) */
const FRAG_EMISSIVE = /* glsl */ `
#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
#else
  vec4 emissiveColor = vec4( 1.0 );
#endif
{
  int id = int( vLight + 0.5 );
  float e = 0.0;
  vec3 tint = vec3( 1.0 );
  if ( id == 1 ) { // low beams: instance power is gated by daylight/weather, including local cars
    // A small intense filament inside a wide, dim skirt: only the filament crosses the night bloom
    // threshold (1.0), so the lamp keeps a soft halo instead of growing a metre-wide white blob.
    vec2 lensUv = (vEmissiveMapUv - uHeadlightRect.xy) / uHeadlightRect.zw;
    float radius = length((lensUv - uHeadlightDisc.xy) / uHeadlightDisc.zw);
    // Once the lamp is a couple of pixels wide the disc aliases to whatever radius the texel lands on,
    // which is why distant headlamps used to vanish. Widen the core by the screen-space footprint so a
    // far lamp resolves to one bright point instead of a random sample of the falloff.
    float lensFootprint = max( fwidth( radius ), 1e-4 );
    float core = 1.0 - smoothstep( 0.0, max( 0.62, lensFootprint * 2.5 ), radius );
    float skirt = 1.0 - smoothstep( 0.35, 1.9, radius );
    e = clamp(vLightA.x, 0.0, 1.0) * max( 1.38 * core, 0.40 * skirt );
    emissiveColor.rgb = vec3(1.0, 0.96, 0.90);
  } else if ( id == 2 ) { // tail: saturated red bar with the lights on, distinctly brighter on brake
    // Both levels used to land on the same clamp, so brake lights never brightened. Running puts the
    // atlas hotspot line just over the night bloom threshold; braking takes the whole lens past it.
    e = 0.12 + clamp( vLightA.x, 0.0, 1.0 ) * 1.6 + vLightA.y * 0.9;
  } else if ( id == 3 ) { // signal left (red rear / amber front: colour from texel)
    e = 0.12 + vLightA.z * vblink( uSeed + vLightB.w ) * 2.6 + vLightA.x * 1.3 + vLightA.y * 1.1;
  } else if ( id == 4 ) {
    e = 0.12 + vLightA.w * vblink( uSeed + vLightB.w ) * 2.6 + vLightA.x * 1.3 + vLightA.y * 1.1;
  } else if ( id == 5 ) { // reverse
    e = 0.08 + vLightB.y * 2.6;
  } else if ( id == 6 ) { // taxi roof sign (available): a warm backlit panel, the brightest thing on a cab
    e = 0.2 + vLightB.z * ( 0.9 + 1.7 * uNight );
  } else if ( id == 10 ) { // dash glow through the windscreen (the glass eats ~4/5 of it)
    e = 0.3 + 1.6 * uNight;
  } else if ( id == 11 ) { // bus destination LED
    e = 2.0 + 0.5 * uNight;
  } else if ( id == 12 ) { // police lightbar: segments by u (red left, white centre, blue right)
    float u = fract( vEmissiveMapUv.x * 2.0 ); // lightbar rect spans half the atlas width
    float ph = uTime * 3.0 + uSeed;
    float red = step( 0.5, fract( ph ) ) * step( u, 0.375 );
    float blue = step( 0.5, fract( ph + 0.5 ) ) * step( 0.625, u );
    float white = step( 0.85, fract( ph * 2.7 ) ) * step( 0.375, u ) * step( u, 0.625 );
    e = vLightB.x * ( red + blue + white ) * 18.0 + 0.25;
  } else if ( id == 13 ) { // dim daytime strip, well below the HDR bloom threshold
    e = 0.08 + vLightA.x * 4.0;
  }
  // Lens radiance, not light power: keep bloom from turning a small lens into a metre-wide source.
  // ART_DIRECTION caps an emitter at 2.5 post-exposure; lenses need that headroom to show up in the
  // wet-asphalt SSR reflection. The headlamp core stays lower still so it never clips to paper white.
  totalEmissiveRadiance *= emissiveColor.rgb * tint * min(e, id == 1 ? 1.38 : id == 13 ? 1.6 : 2.5);
}
`;

export function createVehicleMaterial(atlas: KindAtlas, uniforms: VehicleUniforms, seed: number): THREE.MeshPhysicalMaterial {
  const taxiBody = atlas.taxiBody === true;
  const mat = new THREE.MeshPhysicalMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissive,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: taxiBody ? 0.05 : 0.06,
    color: 0xffffff,
    envMapIntensity: taxiBody ? 1.18 : 1,
    side: THREE.FrontSide,
  });
  mat.name = 'vehicle';
  const seedU = { value: seed };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWet = uniforms.uWet;
    shader.uniforms.uSeed = seedU;
    shader.uniforms.uHeadlightRect = { value: new THREE.Vector4(R.headlight.u0, R.headlight.v0,
      R.headlight.u1 - R.headlight.u0, R.headlight.v1 - R.headlight.v0) };
    shader.uniforms.uHeadlightDisc = { value: taxiBody
      ? new THREE.Vector4(0.3, 0.43, 0.035, 0.15)
      : new THREE.Vector4(0.35, 0.5, 0.085, 0.17) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <beginnormal_vertex>', VERT_NORMAL)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      // paint takes the instance colour; everything else keeps the texel colour
      .replace('#include <color_fragment>', /* glsl */ `
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
          diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, vMat.w );
        #endif
        {
          // Smooth sill grime: subpixel hash cells in colour/roughness alias just like flake normals.
          float g = ( 1.0 - smoothstep( 0.12, 0.62, vLocal.y ) ) * 0.775;
          g *= 0.72 + 0.28 * sin( vLocal.z * 2.1 + vLocal.x * 1.3 + 0.7 ); // road spray is uneven along the sill
          g *= 0.55 + 0.45 * uWet;
          g *= step( 0.5, vMat.w ) * 0.6 + 0.15; // mostly on paint
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.14, 0.12 ), g * 0.45 );
          vGrime = g;
        }
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp( vMat.y + vGrime * 0.35, 0.03, 1.0 );')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.z * ( 1.0 - vGrime * 0.5 );')
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE)
      // Includes are not expanded during onBeforeCompile. Keep the chunk marker
      // (also used by SSR), then apply the per-surface coat before lighting.
      .replace('#include <lights_physical_fragment>', /* glsl */ `
        #include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= vMat.x;
        #endif
      `);
    if (taxiBody) {
      // ART_DIRECTION: dielectric yellow enamel, 0.4 base roughness, smooth clearcoat.
      // Paint and door-print backgrounds share the response; lenses, trim and other kinds do not.
      const coatedBody = 'step( 0.99, vMat.x ) * step( 0.3, vMat.y )';
      shader.fragmentShader = shader.fragmentShader
        // yellow-cab-1: saturated enamel with clear highlights, not a pale diffuse wash.
        // Keep the authored #F5B800 hue rather than the previous green-biased attenuation.
        // The pigment supplies the colour; the smooth outer coat supplies the white highlights.
        // The chroma mask includes printed yellow/green backgrounds but leaves white fare cards alone.
        .replace('float g = ( 1.0 - smoothstep', /* glsl */ `
          float taxiChroma = max( max( diffuseColor.r, diffuseColor.g ), diffuseColor.b )
            - min( min( diffuseColor.r, diffuseColor.g ), diffuseColor.b );
          float taxiEnamel = (${coatedBody}) * max( vMat.w, smoothstep( 0.1, 0.3, taxiChroma ) );
          diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.78 ), taxiEnamel );
          float g = ( 1.0 - smoothstep`)
        // Neutral road film darkens the pigment without adding a brown diffuse wash to the bumper.
        .replace('diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.14, 0.12 ), g * 0.45 );',
          'diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.47, 0.50, 0.49 ), g * 0.45 );')
        .replace('float roughnessFactor = clamp( vMat.y + vGrime * 0.35, 0.03, 1.0 );',
          `float roughnessFactor = clamp( mix( vMat.y, 0.4, ${coatedBody} ) + vGrime * 0.35, 0.03, 1.0 );`)
        .replace('float metalnessFactor = vMat.z * ( 1.0 - vGrime * 0.5 );',
          `float metalnessFactor = vMat.z * ( 1.0 - ${coatedBody} ) * ( 1.0 - vGrime * 0.5 );`)
        // A full-strength rough dielectric lobe below the clearcoat adds a second white sky wash.
        // Attenuate only that buried interface, not the enamel's smooth outer reflection or trim.
        .replace('material.clearcoat *= vMat.x;', /* glsl */ `
          material.clearcoat *= vMat.x;
          float taxiCoat = ${coatedBody};
          material.specularColor *= mix( 1.0, 0.42, taxiCoat );
          material.specularColorBlended *= mix( 1.0, 0.42, taxiCoat );
          material.clearcoatRoughness = min( 1.0, material.clearcoatRoughness + taxiCoat * vGrime * 0.12 );
        `)
        // Keep spray on the painted livery band as well as the adjacent rocker; no new noise or flakes.
        .replace('step( 0.5, vMat.w ) * 0.6 + 0.15', `${coatedBody} * 0.6 + 0.15`);
    }
    // declare vGrime before use
    shader.fragmentShader = shader.fragmentShader.replace('varying vec3 vLocal;', 'varying vec3 vLocal;\nfloat vGrime = 0.0;');
  };
  mat.customProgramCacheKey = () => taxiBody ? 'vehicle-opaque-taxi-v6' : 'vehicle-opaque-v6';
  return mat;
}

export function createGlassMaterial(uniforms: VehicleUniforms): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x05080b),
    roughness: 0.03,
    metalness: 0.0,
    transparent: true,
    opacity: 0.74, // dark enough to read as one band; partition and seats still show face-on
    clearcoat: 0,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    specularIntensity: 1,
    ior: 1.5,
  });
  mat.name = 'vehicle-glass';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <beginnormal_vertex>', VERT_NORMAL)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vMat; varying float vLight; varying vec4 vLightA; varying vec4 vLightB; varying vec3 vLocal; uniform float uNight;')
      // stronger fresnel: more opaque (reflective) at grazing angles, interior visible face-on
      .replace('#include <dithering_fragment>', /* glsl */ `
        #include <dithering_fragment>
      `)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', /* glsl */ `
        vec4 diffuseColor = vec4( diffuse, opacity );
        {
          vec3 vd = normalize( vViewPosition );
          float fr = pow( 1.0 - abs( dot( vd, normalize( vNormal ) ) ), 3.0 );
          diffuseColor.a = clamp( opacity + fr * 0.3 + uNight * 0.05, 0.0, 1.0 );
          // Taxi exterior glazing is -2; clear lamp covers are -1. Both remain in the existing
          // glass batch. Partitions and all other vehicle styles retain the shared response.
          if ( vMat.w < -1.5 ) {
            diffuseColor.a = clamp( 0.78 + fr * 0.22 + uNight * 0.05, 0.0, 1.0 );
          } else if ( vMat.w < -0.5 ) {
            diffuseColor.rgb = vec3( 0.015, 0.021, 0.027 );
            diffuseColor.a = 0.08 + fr * 0.22;
          }
        }
      `)
      .replace('#include <opaque_fragment>', /* glsl */ `
        // Ordinary alpha blending would attenuate the Fresnel reflection a second time.
        // Preserve the live environment reflection on every windscreen as well as lamp covers.
        // Use the existing environment input, not painted-on highlight stripes.
        outgoingLight = totalDiffuse + totalSpecular / max( diffuseColor.a, 0.04 );
        #include <opaque_fragment>
      `);
  };
  mat.customProgramCacheKey = () => 'vehicle-glass-v3';
  return mat;
}
