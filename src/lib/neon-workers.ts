/**
 * Postgres access on Cloudflare Workers.
 *
 * node-postgres over `cloudflare:sockets` keeps a socket in a module-level
 * pool, and Workers cannot reuse I/O objects across requests, so every
 * request after (and often including) the first one dies with a 1101.
 * On Workers we use Neon's serverless driver instead:
 *   - plain queries go over HTTPS (one fetch per query, nothing kept open);
 *   - `begin` opens a WebSocket Client that carries the transaction until
 *     `commit` / `rollback`, then closes it.
 * Node and Vercel keep the regular `pg` Pool.
 */
type Parser = (value: string) => unknown;

type TypeSource = { getTypeParser: (oid: number, format?: never) => unknown };

/** Driver defaults (bool, int4, timestamptz, json, ...) plus our overrides. */
export function workersTypes(overrides: Record<number, Parser>, base: TypeSource) {
  return {
    getTypeParser(oid: number, format?: string) {
      if (format !== "binary" && overrides[oid]) return overrides[oid];
      return base.getTypeParser(oid, format as never);
    },
  };
}

type Row = Record<string, unknown>;

export function createNeonWorkersRunner(
  connectionString: string,
  overrides: Record<number, Parser>,
) {
  let tx: { query: (t: string, p?: unknown[]) => Promise<{ rows: Row[] }>; end: () => Promise<void> } | undefined;

  return async function run<T>(text: string, params: unknown[] = []): Promise<T[]> {
    const head = text.trim().toLowerCase();
    const mod = await import("@neondatabase/serverless");
    const types = workersTypes(overrides, mod.types as unknown as TypeSource);
    if (/^(begin|start transaction)\b/.test(head)) {
      const client = new mod.Client({ connectionString, types } as never);
      await client.connect();
      tx = client as never;
      await client.query(text, params as never[]);
      return [];
    }
    if (tx) {
      const client = tx;
      const done = /^(commit|rollback|end)\b/.test(head) && !head.includes(" to ");
      try {
        return (await client.query(text, params)).rows as T[];
      } finally {
        if (done) {
          tx = undefined;
          await client.end().catch(() => {});
        }
      }
    }
    const http = mod.neon(connectionString);
    const res = (await http.query(text, params as never[], {
      fullResults: true,
      types,
    } as never)) as unknown as { rows: Row[] };
    return res.rows as T[];
  };
}
