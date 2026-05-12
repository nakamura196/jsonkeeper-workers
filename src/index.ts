import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './auth';
import { buildCollection, type ActivityRow } from './activitystreams';
import { detectTopLevelType, rewriteIds } from './curation';

type Bindings = {
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  REWRITE_TYPES: string;
};

type Variables = {
  uid?: string;
  email?: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Firebase-ID-Token',
      'X-Access-Token',
      'X-Unlisted',
    ],
    exposeHeaders: ['Location'],
    maxAge: 86400,
  }),
);

const rewriteTypes = (env: Bindings) =>
  env.REWRITE_TYPES.split(',').map((s) => s.trim()).filter(Boolean);

const serverOrigin = (url: string) => new URL(url).origin;

const truthyHeader = (v: string | undefined): 0 | 1 => {
  if (!v) return 0;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' ? 1 : 0;
};

const toISO = (unixSec: number) => new Date(unixSec * 1000).toISOString();

const extractLabel = (jsonStr: string): unknown => {
  try {
    const obj = JSON.parse(jsonStr);
    if (obj && typeof obj === 'object' && 'label' in obj) return obj.label;
  } catch {
    /* ignore */
  }
  return null;
};

app.get('/', (c) =>
  c.json({
    name: 'jsonkeeper-workers',
    endpoints: [
      'POST /api',
      'GET /api/:id',
      'PUT /api/:id',
      'PATCH /api/:id',
      'DELETE /api/:id',
      'GET /api/userdocs',
      'GET /as/collection.json',
    ],
  }),
);

app.post('/api', authMiddleware({ required: false }), async (c) => {
  const raw = await c.req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const id = crypto.randomUUID();
  const origin = serverOrigin(c.req.url);
  const docUrl = `${origin}/api/${id}`;
  const types = rewriteTypes(c.env);
  const matched = detectTopLevelType(parsed as never, types);
  const stored = matched ? rewriteIds(parsed as never, types, docUrl) : parsed;

  const now = Math.floor(Date.now() / 1000);
  const uid = c.get('uid') ?? null;
  const unlisted = uid ? truthyHeader(c.req.header('X-Unlisted')) : 0;
  await c.env.DB.prepare(
    `INSERT INTO documents (id, json, owner_uid, content_type, jsonld_type, unlisted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      JSON.stringify(stored),
      uid,
      c.req.header('Content-Type') ?? 'application/json',
      matched,
      unlisted,
      now,
      now,
    )
    .run();

  c.header('Location', docUrl);
  return c.json(stored as Record<string, unknown>, 201);
});

app.get('/api/userdocs', authMiddleware({ required: true }), async (c) => {
  const uid = c.get('uid')!;
  const { results } = await c.env.DB.prepare(
    `SELECT id, json, jsonld_type, unlisted, created_at, updated_at
     FROM documents WHERE owner_uid = ? ORDER BY created_at DESC LIMIT 1000`,
  )
    .bind(uid)
    .all<{
      id: string;
      json: string;
      jsonld_type: string | null;
      unlisted: number;
      created_at: number;
      updated_at: number;
    }>();

  const items = results.map((r) => ({
    id: r.id,
    label: extractLabel(r.json),
    jsonld_type: r.jsonld_type,
    unlisted: r.unlisted === 1,
    created_at: toISO(r.created_at),
    updated_at: toISO(r.updated_at),
  }));
  return c.json(items);
});

app.get('/api/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT json, content_type FROM documents WHERE id = ?',
  )
    .bind(c.req.param('id'))
    .first<{ json: string; content_type: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return new Response(row.json, {
    status: 200,
    headers: {
      'Content-Type': row.content_type,
      'Access-Control-Allow-Origin': '*',
    },
  });
});

app.put('/api/:id', authMiddleware({ required: true }), async (c) => {
  const id = c.req.param('id');
  const uid = c.get('uid')!;
  const row = await c.env.DB.prepare('SELECT owner_uid FROM documents WHERE id = ?')
    .bind(id)
    .first<{ owner_uid: string | null }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.owner_uid !== uid) return c.json({ error: 'Forbidden' }, 403);

  const raw = await c.req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  const origin = serverOrigin(c.req.url);
  const docUrl = `${origin}/api/${id}`;
  const types = rewriteTypes(c.env);
  const matched = detectTopLevelType(parsed as never, types);
  const stored = matched ? rewriteIds(parsed as never, types, docUrl) : parsed;
  const unlistedHeader = c.req.header('X-Unlisted');

  if (unlistedHeader !== undefined) {
    await c.env.DB.prepare(
      `UPDATE documents SET json = ?, content_type = ?, jsonld_type = ?, unlisted = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(
        JSON.stringify(stored),
        c.req.header('Content-Type') ?? 'application/json',
        matched,
        truthyHeader(unlistedHeader),
        Math.floor(Date.now() / 1000),
        id,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `UPDATE documents SET json = ?, content_type = ?, jsonld_type = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(
        JSON.stringify(stored),
        c.req.header('Content-Type') ?? 'application/json',
        matched,
        Math.floor(Date.now() / 1000),
        id,
      )
      .run();
  }

  return c.json(stored as Record<string, unknown>);
});

app.patch('/api/:id', authMiddleware({ required: true }), async (c) => {
  const id = c.req.param('id');
  const uid = c.get('uid')!;
  const row = await c.env.DB.prepare('SELECT owner_uid FROM documents WHERE id = ?')
    .bind(id)
    .first<{ owner_uid: string | null }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.owner_uid !== uid) return c.json({ error: 'Forbidden' }, 403);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!('unlisted' in body) || typeof body.unlisted !== 'boolean') {
    return c.json({ error: 'Only {unlisted: bool} is supported' }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE documents SET unlisted = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(body.unlisted ? 1 : 0, Math.floor(Date.now() / 1000), id)
    .run();
  return c.json({ id, unlisted: body.unlisted });
});

app.delete('/api/:id', authMiddleware({ required: true }), async (c) => {
  const id = c.req.param('id');
  const uid = c.get('uid')!;
  const row = await c.env.DB.prepare('SELECT owner_uid FROM documents WHERE id = ?')
    .bind(id)
    .first<{ owner_uid: string | null }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.owner_uid !== uid) return c.json({ error: 'Forbidden' }, 403);
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();
  return new Response(null, { status: 204 });
});

app.get('/as/collection.json', async (c) => {
  const types = rewriteTypes(c.env);
  const placeholders = types.map(() => '?').join(',') || "''";
  const { results } = await c.env.DB.prepare(
    `SELECT id, jsonld_type, created_at, updated_at
     FROM documents WHERE unlisted = 0 AND jsonld_type IN (${placeholders})
     ORDER BY created_at DESC LIMIT 5000`,
  )
    .bind(...types)
    .all<ActivityRow>();
  const collection = buildCollection(serverOrigin(c.req.url), results);
  return new Response(JSON.stringify(collection), {
    status: 200,
    headers: {
      'Content-Type': 'application/activity+json',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

export default app;
