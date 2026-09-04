/**
 * Quality detection. Picks a level from the GPU string, pixel ratio, screen size, cores and mobile-ness.
 * ?q=low|medium|high|ultra overrides.
 */
import type { Quality } from './context';

export type QualityLevel = Quality['level'];

const TABLE: Record<QualityLevel, Omit<Quality, 'level' | 'pixelRatio'> & { pixelRatio: (dpr: number) => number }> = {
  mobile: { pixelRatio: (d) => Math.min(d, 1.25), shadows: true, shadowMapSize: 1024, ssao: false, bloom: false, reflections: false, drawDistance: 512, farDistance: 768, maxTraffic: 20, maxPeds: 30 },
  ultra: { pixelRatio: (d) => Math.min(d, 2), shadows: true, shadowMapSize: 4096, ssao: true, bloom: true, reflections: true, drawDistance: 1200, farDistance: 6000, maxTraffic: 120, maxPeds: 300 },
  high: { pixelRatio: (d) => Math.min(d, 1.5), shadows: true, shadowMapSize: 2048, ssao: true, bloom: true, reflections: false, drawDistance: 1000, farDistance: 5000, maxTraffic: 80, maxPeds: 220 },
  medium: { pixelRatio: () => 0.8, shadows: true, shadowMapSize: 1024, ssao: false, bloom: false, reflections: false, drawDistance: 700, farDistance: 3000, maxTraffic: 30, maxPeds: 40 },
  low: { pixelRatio: () => 0.75, shadows: true, shadowMapSize: 512, ssao: false, bloom: false, reflections: false, drawDistance: 600, farDistance: 2500, maxTraffic: 20, maxPeds: 20 },
};

export interface DeviceInfo {
  gpu: string;
  vendor: string;
  dpr: number;
  screenW: number;
  screenH: number;
  cores: number;
  mobile: boolean;
  software: boolean;
  webgl2: boolean;
}

/** CPU-only detection: safe to run before the entry form, including iPad desktop UA. */
export function isIOS(): boolean {
  return typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (/Mac/i.test(navigator.userAgent + navigator.platform) && navigator.maxTouchPoints > 0));
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return isIOS() || /Android|Mobile|Silk/i.test(navigator.userAgent) ||
    (typeof memory === 'number' && memory <= 4) ||
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
}

/** Never fetch/decode the desktop 2K images on mobile. Keep manifest metadata unchanged. */
export function mobileTextureUrl(url: string): string {
  return isMobileDevice() && /\/assets\/textures\/.*\.jpg(?:[?#]|$)/i.test(url)
    ? url.replace('/assets/textures/', '/assets/textures-mobile/') : url;
}

export function mobilePixelRatio(dpr: number, width: number, height: number): number {
  return isIOS() ? Math.min(dpr, 1, Math.sqrt(1_200_000 / Math.max(1, width * height)))
    : Math.min(dpr, 1.25, Math.sqrt(1_500_000 / Math.max(1, width * height)));
}

export function probeDevice(): DeviceInfo {
  let gpu = 'unknown';
  let vendor = 'unknown';
  let webgl2 = false;
  try {
    if (isIOS()) throw new Error('iOS uses the conservative tier without a GPU probe');
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      webgl2 = gl instanceof WebGL2RenderingContext;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
        vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
      } else {
        gpu = String(gl.getParameter(gl.RENDERER));
        vendor = String(gl.getParameter(gl.VENDOR));
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* no webgl: treated as software below */
  }
  const mobile = isMobileDevice();
  const software = /swiftshader|llvmpipe|software|mesa offscreen|basic render/i.test(gpu);
  return { gpu, vendor, dpr: window.devicePixelRatio || 1, screenW: screen.width, screenH: screen.height, cores: navigator.hardwareConcurrency || 4, mobile, software, webgl2 };
}

/** heuristic level from a device probe */
export function levelFor(d: DeviceInfo): QualityLevel {
  const g = d.gpu.toLowerCase();
  if (d.mobile) return 'mobile';
  if (d.software) return 'low';
  // Apple silicon
  if (/apple m\d|apple gpu|apple m/.test(g)) {
    if (/apple m\d/.test(g) && d.cores >= 16) return 'ultra';
    // Leave frame-time headroom on lower-core unified-memory devices; high's AO/cascades
    // exceeded the 60 Hz budget in measured M2 Max sessions. Explicit presets still override.
    return 'medium';
  }
  // NVIDIA
  if (/geforce.*rtx\s*[3-9]\d{3}/.test(g) && !/laptop|mobile|notebook/.test(g)) return 'ultra';
  if (/rtx\s*20|rtx\s*2\d{2}|gtx\s*1[06-9]|gtx\s*[2-9]0\d{1,2}|rtx\s*a/.test(g)) return 'high';
  if (/geforce|nvidia/.test(g)) return 'medium';
  // AMD
  if (/radeon rx\s*[6-9]\d{3}\b/.test(g) && !/laptop|mobile/.test(g)) return 'ultra';
  if (/radeon rx|radeon\(tm\) rx|amd radeon/.test(g)) return 'high';
  if (/radeon|amd/.test(g)) return 'medium';
  // Intel integrated
  if (/intel.*(arc)/.test(g)) return 'high';
  if (/intel.*(iris|xe)/.test(g)) return 'medium';
  if (/intel/.test(g)) return 'low';
  // Unknown desktop: size and cores as a hint
  if (d.cores >= 8 && d.screenW * d.screenH >= 1920 * 1080) return 'high';
  if (d.cores >= 4) return 'medium';
  return 'low';
}

export function buildQuality(level: QualityLevel, dpr: number): Quality {
  const t = TABLE[level];
  return { level, pixelRatio: t.pixelRatio(dpr), shadows: t.shadows, shadowMapSize: t.shadowMapSize, ssao: t.ssao, bloom: t.bloom, reflections: t.reflections, drawDistance: t.drawDistance, farDistance: t.farDistance, maxTraffic: t.maxTraffic, maxPeds: t.maxPeds };
}

export function isQualityLevel(s: string | null | undefined): s is QualityLevel {
  return s === 'mobile' || s === 'low' || s === 'medium' || s === 'high' || s === 'ultra';
}

export function detectQuality(override?: string | null): { quality: Quality; device: DeviceInfo; auto: QualityLevel } {
  const device = probeDevice();
  const auto = levelFor(device);
  const level: QualityLevel = device.mobile ? 'mobile' : isQualityLevel(override) ? override : auto;
  const quality = buildQuality(level, device.dpr);
  if (level === 'mobile') {
    quality.pixelRatio = mobilePixelRatio(override === 'low' ? 0.75 : device.dpr, innerWidth, innerHeight);
    quality.shadows = !isIOS() && override !== 'low';
    if (override === 'low') quality.maxPeds = 20;
    if (isIOS()) {
      quality.pixelRatio = mobilePixelRatio(1, innerWidth, innerHeight);
      quality.farDistance = quality.drawDistance = 512;
      quality.maxTraffic = 6;
      quality.maxPeds = 8;
      quality.shadows = quality.ssao = quality.bloom = quality.reflections = false;
    }
  }
  return { quality, device, auto };
}
