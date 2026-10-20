// MedTap family sync relay (Cloudflare Worker + KV). Stores each phone's latest encrypted snapshot.
// It never sees anything readable: snapshots are encrypted on the phones with a key the relay never gets,
// and the family id in the address is a hash that can't be turned back into the key.
//
//   GET    /v1/<family>            → [{ device, at, size }]   (each phone's latest snapshot)
//   GET    /v1/<family>/<device>   → the encrypted snapshot
//   PUT    /v1/<family>/<device>   → store it (x-medtap-token header must match the family's first writer)
//   DELETE /v1/<family>/<device>   → remove it (same token)

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_SECONDS = 180 * 24 * 3600; // snapshots of phones not seen for 6 months expire

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-medtap-token',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

async function sha256(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The first phone to write sets the family's token; later writes must match it. */
async function allowed(env, family, token) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  const hash = await sha256(token);
  const owner = await env.SYNC.get(`${family}#token`);
  if (!owner) {
    await env.SYNC.put(`${family}#token`, hash);
    return true;
  }
  return owner === hash;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const m = new URL(req.url).pathname.match(/^\/v1\/([0-9a-f]{32})(?:\/([A-Za-z0-9-]{8,64}))?$/);
    if (!m) return json({ error: 'not found' }, 404);
    const [, family, device] = m;

    if (req.method === 'GET' && !device) {
      const list = await env.SYNC.list({ prefix: `${family}/` });
      return json(list.keys.map((k) => ({ device: k.name.slice(family.length + 1), at: k.metadata?.at ?? 0, size: k.metadata?.size ?? 0 })));
    }
    if (!device) return json({ error: 'not found' }, 404);

    if (req.method === 'GET') {
      const body = await env.SYNC.get(`${family}/${device}`, 'arrayBuffer');
      return body ? new Response(body, { headers: { ...cors, 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } }) : json({ error: 'not found' }, 404);
    }
    if (req.method === 'PUT' || req.method === 'DELETE') {
      if (!(await allowed(env, family, req.headers.get('x-medtap-token')))) return json({ error: 'forbidden' }, 403);
      if (req.method === 'DELETE') {
        await env.SYNC.delete(`${family}/${device}`);
        return json({ ok: true });
      }
      const body = await req.arrayBuffer();
      if (body.byteLength > MAX_BYTES) return json({ error: 'too large' }, 413);
      await env.SYNC.put(`${family}/${device}`, body, { expirationTtl: KEEP_SECONDS, metadata: { at: Date.now(), size: body.byteLength } });
      return json({ ok: true });
    }
    return json({ error: 'method not allowed' }, 405);
  },
};
