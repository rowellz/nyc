// The mirror's hashed filenames stay unchanged when this service patches their
// contents. Version the import graph so an existing Safari cache cannot keep
// serving the old entry, worker or shared build queue after a deployment.
export const CLIENT_REVISION = 'tunnel-markings-20';
const assets = /((?:\.\/|\/world\/assets\/|assets\/|\/world-addons\/)(?:[\w.-]+-[\w-]{8}\.js|mobile-build-policy\.js|mobile-road-material\.js|mobile-props\.js|predictive-streaming\.js|startup-policy\.js|traffic-distribution\.js|mobile-map\.js))(?=["'`])/g;

export function versionClientImports(source) {
  return source.replace(assets, `$1?v=${CLIENT_REVISION}`);
}
