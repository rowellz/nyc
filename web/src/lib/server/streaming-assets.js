/** Schedule the mirrored client's tiles and street builds using the same route priority. */
export const streamingAssetPaths = new Set(['world/assets/main-D_3aygO4.js', 'world/assets/streets-CfYSUqyW.js',
  'world/assets/quality-BuEwAkMy.js']);

export function streamingAssetTransform(rel, source) {
  if (!streamingAssetPaths.has(rel)) return source;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Streaming override anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  if (rel.endsWith('/main-D_3aygO4.js')) {
    source = "import { configureStreaming as $configureStreaming, canCommitSceneTile as $canCommitSceneTile } from './predictive-streaming.js';\n" + source;
    replace('(t.busy??0)<16', '$canCommitSceneTile(t,o)');
    replace('O=new Pl(S,v,t.world)', 'O=$configureStreaming(new Pl(S,v,t.world),x.camera)');
  } else if (rel.endsWith('/quality-BuEwAkMy.js')) {
    // Keep mobile at 512 m, including its far layer, to bound scene memory.
    // The mirrored iOS override already sets both distances to 512 m.
    replace('drawDistance:512,farDistance:768', 'drawDistance:512,farDistance:512');
    replace('drawDistance:700,farDistance:3e3', 'drawDistance:1500,farDistance:3e3');
    replace('drawDistance:600,farDistance:2500', 'drawDistance:1500,farDistance:2500');
    replace('drawDistance:1e3,farDistance:5e3', 'drawDistance:1500,farDistance:5e3');
    replace('drawDistance:1200,farDistance:6e3', 'drawDistance:1500,farDistance:6e3');
  } else {
    replace('o=i*i+a*a;o<r&&(n=t,r=o)',
      'o=e.world.tilePriority?.(t.tile.tx,t.tile.tz)??i*i+a*a;o<r&&(n=t,r=o)');
  }
  return source;
}
