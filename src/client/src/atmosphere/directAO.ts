import * as THREE from 'three';
import { N8AOPostPass } from 'n8ao';

// Adapter for pinned n8ao 2.0.1: its final copy samples an identically sized
// HDR target without applying any effect. Keep all AO/denoising shaders intact.
type OutputInternals = {
  outputTargetInternal: THREE.WebGLRenderTarget;
  copyQuad: { render(renderer: THREE.WebGLRenderer): void };
};
const skipCopy = () => {};

export class DirectN8AOPostPass extends N8AOPostPass {
  override render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget,
    output: THREE.WebGLRenderTarget, deltaTime?: number, stencilTest?: boolean): void {
    const internals = this as unknown as OutputInternals;
    const scratch = internals.outputTargetInternal;
    // Screen output needs the vendor's intermediate format conversion. Likewise
    // retain its path for custom composers with aliased/differently sized buffers.
    if (this.renderToScreen || input === output || output.width !== scratch.width
      || output.height !== scratch.height || output.texture.type !== input.texture.type
      || output.texture.format !== input.texture.format) {
      super.render(renderer, input, output, deltaTime, stencilTest);
      return;
    }
    const copy = internals.copyQuad.render;
    internals.outputTargetInternal = output;
    internals.copyQuad.render = skipCopy;
    try {
      super.render(renderer, input, output, deltaTime, stencilTest);
    } finally {
      // The composer owns output: never let vendor resize/disposal own it.
      internals.outputTargetInternal = scratch;
      internals.copyQuad.render = copy;
    }
  }
}
