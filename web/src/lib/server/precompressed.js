import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

/** Prefer Brotli on ties, while respecting explicit exclusions and identity. */
export function preferredEncoding(acceptEncoding) {
  if (!acceptEncoding?.trim()) return 'identity';
  const weights = new Map();
  for (const entry of acceptEncoding.toLowerCase().split(',')) {
    const [name, ...params] = entry.trim().split(';');
    const q = params.find(p => p.trim().startsWith('q='));
    const weight = q ? Number(q.trim().slice(2)) : 1;
    weights.set(name.trim(), Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0);
  }
  const weight = encoding => weights.get(encoding) ?? (encoding === 'identity'
    ? weights.get('*') === 0 ? 0 : 1 : weights.get('*') ?? 0);
  return ['br', 'gzip', 'identity'].filter(e => weight(e) > 0)
    .sort((a, b) => weight(b) - weight(a))[0] ?? null;
}

/** Only called for build-prepared JS/CSS; gzip map tiles never enter this path. */
export async function precompressedResponse(directory, rel, headers, options) {
  headers.vary = 'Accept-Encoding';
  const encoding = preferredEncoding(options.acceptEncoding);
  if (encoding === 'identity') return null;
  if (!encoding) return new Response(null, { status: 406, headers: { vary: headers.vary } });
  const file = path.join(directory, `${rel}.${encoding === 'gzip' ? 'gz' : 'br'}`);
  const info = await stat(file);
  headers['content-encoding'] = encoding;
  headers['content-length'] = String(info.size);
  const body = options.method?.toUpperCase() === 'HEAD' ? null : Readable.toWeb(createReadStream(file));
  return new Response(body, { headers });
}
