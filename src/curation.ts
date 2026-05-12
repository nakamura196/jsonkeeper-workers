type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [k: string]: JsonValue };

export function detectTopLevelType(doc: JsonValue, rewriteTypes: string[]): string | null {
  if (!isObject(doc)) return null;
  const types = toArray(doc['@type']);
  for (const t of types) {
    if (typeof t === 'string' && rewriteTypes.includes(t)) return t;
  }
  return null;
}

/**
 * Rewrite @id for the top-level node and any nested node whose @type is in
 * rewriteTypes. The top-level gets `docUrl`; nested matching nodes get
 * `docUrl#frag-<n>` so each remains addressable and stable per document.
 */
export function rewriteIds(
  doc: JsonValue,
  rewriteTypes: string[],
  docUrl: string,
): JsonValue {
  if (!isObject(doc)) return doc;
  const cloned = deepClone(doc);
  let counter = 0;
  const walk = (node: JsonValue, isTop: boolean) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, false);
      return;
    }
    if (!isObject(node)) return;
    const types = toArray(node['@type']).filter((t): t is string => typeof t === 'string');
    const matches = types.some((t) => rewriteTypes.includes(t));
    if (matches) {
      node['@id'] = isTop ? docUrl : `${docUrl}#frag-${counter++}`;
    }
    for (const key of Object.keys(node)) {
      if (key === '@type' || key === '@id') continue;
      walk(node[key], false);
    }
  };
  walk(cloned, true);
  return cloned;
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
