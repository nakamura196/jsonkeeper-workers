import type { Context, MiddlewareHandler } from 'hono';
import { decodeProtectedHeader, importX509, jwtVerify } from 'jose';

const GOOGLE_X509_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

type JwkCache = { keys: Record<string, CryptoKey>; expiresAt: number };
let jwkCache: JwkCache | null = null;

async function getSigningKey(kid: string): Promise<CryptoKey> {
  if (!jwkCache || Date.now() >= jwkCache.expiresAt) {
    const res = await fetch(GOOGLE_X509_URL);
    if (!res.ok) throw new Error(`JWK fetch failed: ${res.status}`);
    const certs = (await res.json()) as Record<string, string>;
    const maxAge = parseMaxAge(res.headers.get('cache-control')) ?? 3600;
    const keys: Record<string, CryptoKey> = {};
    for (const [k, pem] of Object.entries(certs)) {
      keys[k] = (await importX509(pem, 'RS256')) as CryptoKey;
    }
    jwkCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  }
  const key = jwkCache.keys[kid];
  if (!key) {
    jwkCache = null;
    throw new Error(`Unknown signing kid: ${kid}`);
  }
  return key;
}

function parseMaxAge(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const m = cacheControl.match(/max-age=(\d+)/);
  return m ? Number(m[1]) : null;
}

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
): Promise<{ uid: string; email?: string }> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== 'RS256') throw new Error(`Unexpected alg: ${header.alg}`);
  if (!header.kid) throw new Error('Missing kid');

  const key = await getSigningKey(header.kid);
  const { payload } = await jwtVerify(token, key, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ['RS256'],
  });
  if (!payload.sub) throw new Error('Missing sub');
  return { uid: payload.sub, email: payload.email as string | undefined };
}

export type AuthEnv = {
  Variables: { uid?: string; email?: string };
  Bindings: { FIREBASE_PROJECT_ID: string };
};

export function authMiddleware(opts: { required: boolean }): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const token = extractToken(c);
    if (!token) {
      if (opts.required) return c.json({ error: 'Authentication required' }, 401);
      return next();
    }
    try {
      const { uid, email } = await verifyFirebaseIdToken(token, c.env.FIREBASE_PROJECT_ID);
      c.set('uid', uid);
      if (email) c.set('email', email);
    } catch (e) {
      if (opts.required) {
        return c.json({ error: 'Invalid token', detail: String(e) }, 401);
      }
    }
    return next();
  };
}

function extractToken(c: Context): string | undefined {
  const direct = c.req.header('X-Firebase-ID-Token') ?? c.req.header('x-firebase-id-token');
  if (direct) return direct;
  const auth = c.req.header('Authorization') ?? c.req.header('authorization');
  if (!auth) return undefined;
  const [scheme, value] = auth.split(/\s+/, 2);
  return scheme?.toLowerCase() === 'bearer' ? value : undefined;
}
