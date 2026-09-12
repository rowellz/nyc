/** Schedule the mirrored client's tiles and street builds using the same route priority. */
export const streamingAssetPaths = new Set(['world/assets/main-D_3aygO4.js', 'world/assets/streets-CfYSUqyW.js',
  'world/assets/quality-BuEwAkMy.js', 'world/assets/mobile-D4ic5hjY.js']);

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
    // Set both the preset and iOS's later override; changing only the preset
    // leaves real iPhones at 512 m even when desktop q=mobile looks correct.
    replace('drawDistance:512,farDistance:768', 'drawDistance:1500,farDistance:1500');
    replace('drawDistance:700,farDistance:3e3', 'drawDistance:1500,farDistance:3e3');
    replace('drawDistance:600,farDistance:2500', 'drawDistance:1500,farDistance:2500');
    replace('drawDistance:1e3,farDistance:5e3', 'drawDistance:1500,farDistance:5e3');
    replace('drawDistance:1200,farDistance:6e3', 'drawDistance:1500,farDistance:6e3');
    replace('u.farDistance=u.drawDistance=512', 'u.farDistance=u.drawDistance=1500');
  } else if (rel.endsWith('/mobile-D4ic5hjY.js')) {
    // The camera already reaches 12 km. Mobile's hard-coded fog, however,
    // completely concealed geometry after 700 m regardless of loaded tiles.
    replace('new t(l,180,700)', 'new t(l,1200,2100)');
  } else {
    replace('o=i*i+a*a;o<r&&(n=t,r=o)',
      'o=e.world.tilePriority?.(t.tile.tx,t.tile.tz)??i*i+a*a;o<r&&(n=t,r=o)');
  }
  return source;
}
