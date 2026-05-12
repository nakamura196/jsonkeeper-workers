export type ActivityRow = {
  id: string;
  created_at: number;
  updated_at: number;
  jsonld_type: string | null;
};

export function buildCollection(serverUrl: string, rows: ActivityRow[]) {
  const collectionId = `${serverUrl}/as/collection.json`;
  const items = rows.map((r) => ({
    id: `${collectionId}#activity-${r.id}`,
    type: r.created_at === r.updated_at ? 'Create' : 'Update',
    endTime: new Date(r.updated_at * 1000).toISOString(),
    object: {
      id: `${serverUrl}/api/${r.id}`,
      type: r.jsonld_type ?? undefined,
    },
  }));
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: collectionId,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  };
}
