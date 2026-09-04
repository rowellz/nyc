/**
 * WebGLRenderer + camera + resize. Anti-aliasing is left to post-processing (atmosphere module).
 * Tone mapping default ACESFilmic / exposure 1 -- the atmosphere module may change it.
 */
import * as THREE from 'three';
import { isIOS, mobilePixelRatio } from './quality';
import { handleContextLoss, hasGameStarted, isNameFormUp } from './crashGuard';
import { installTextureRelease, prepareTextureUploads } from './textureRelease';
import type { Quality } from './context';

export interface RendererBundle {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  worldGroup: THREE.Group;
  canvas: HTMLCanvasElement;
  /** call when quality.pixelRatio changes */
  applyPixelRatio(pr: number): void;
  resize(): void;
  dispose(): void;
}

export const CAMERA_FOV = 60;
export const CAMERA_NEAR = 0.3;
export const CAMERA_FAR = 12000;

export function createRenderer(canvas: HTMLCanvasElement, quality: Quality, opts: { fov?: number | null; preserveDrawingBuffer?: boolean } = {}): RendererBundle {
  if (isIOS()) installTextureRelease();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: false,
    preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    // 'default' lets Chrome fail over to software; we want to know when we don't have a GPU
    failIfMajorPerformanceCaveat: false,
  });
  if (isIOS()) prepareTextureUploads(renderer);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = quality.shadows;
  // three r185 deprecated PCFSoftShadowMap (it silently became PCF + a console warning); PCF is what you get either way
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x0b0e14, 1);
  renderer.info.autoReset = false; // the loop resets once per frame so multi-pass composers still report totals
  renderer.setPixelRatio(quality.pixelRatio);

  const camera = new THREE.PerspectiveCamera(opts.fov ?? CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(0, 1.7, 0);
  camera.rotation.order = 'YXZ';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e14);
  const worldGroup = new THREE.Group();
  worldGroup.name = 'world';
  scene.add(worldGroup);
  scene.add(camera); // so audio listener / view-attached objects work

  let pixelRatio = quality.pixelRatio;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastW = 0, lastH = 0, lastPR = 0;
  function resize(): void {
    if (isIOS() && (!hasGameStarted() || isNameFormUp())) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = quality.level === 'mobile' ? mobilePixelRatio(pixelRatio, w, h) : pixelRatio;
    if (isIOS() && w === lastW && h === lastH && pr === lastPR) return;
    lastW = w; lastH = h; lastPR = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, true);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  function applyPixelRatio(pr: number): void {
    pixelRatio = pr;
    resize();
  }
  resize();
  const onResize = () => {
    if (!isIOS()) { resize(); return; }
    if (!hasGameStarted() || isNameFormUp()) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 500);
  };
  window.addEventListener('resize', onResize);
  if (isIOS()) window.visualViewport?.addEventListener('resize', onResize);

  canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
      handleContextLoss();
    },
    false,
  );
  canvas.addEventListener('webglcontextrestored', () => console.warn('[renderer] WebGL context restored'), false);

  return {
    renderer,
    camera,
    scene,
    worldGroup,
    canvas,
    applyPixelRatio,
    resize,
    dispose() {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      if (isIOS()) window.visualViewport?.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}
