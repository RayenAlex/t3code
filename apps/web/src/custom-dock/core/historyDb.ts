import type { RunHistory, RunSummary, ThreadMeta } from "../host/types";

const DATABASE = "t3-custom-dock-v1";
const STORE = "runSummaries";
const LIMIT = 50;

type Row = { key: string; scope: string; summary: RunSummary };

function byNewest(a: RunSummary, b: RunSummary): number {
  return b.completedAt.localeCompare(a.completedAt) || b.runId.localeCompare(a.runId);
}

export function createRunHistory(
  factory: IDBFactory | null = globalThis.indexedDB ?? null,
): RunHistory {
  const memory = new Map<string, Map<string, RunSummary>>();
  let database: Promise<IDBDatabase | null> | undefined;
  function open() {
    return (database ??= new Promise<IDBDatabase | null>((resolve, reject) => {
      if (!factory) return resolve(null);
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("scope", "scope");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve(null);
    }).catch(() => null));
  }

  const scopeKey = (scope: ThreadMeta) => JSON.stringify([scope.environmentId, scope.threadId]);

  async function transaction<T>(
    scope: string,
    mode: IDBTransactionMode,
    useRows: (rows: Row[], store: IDBObjectStore) => T,
  ): Promise<T | undefined> {
    const db = await open();
    if (!db) return undefined;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const request = store.index("scope").getAll(scope);
      let result: T;
      request.onsuccess = () => {
        result = useRows(request.result as Row[], store);
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    }).catch(() => undefined);
  }

  return {
    async list(ref) {
      const key = scopeKey(ref);
      const stored = await transaction(key, "readonly", (rows) => rows.map((row) => row.summary));
      const merged = new Map(stored?.map((summary) => [summary.runId, summary]));
      for (const summary of memory.get(key)?.values() ?? []) merged.set(summary.runId, summary);
      return [...merged.values()].sort(byNewest).slice(0, LIMIT);
    },
    async put(ref, summary) {
      if (summary.status !== "complete" || !Number.isFinite(Date.parse(summary.completedAt)))
        return;
      const scope = scopeKey(ref);
      const row = {
        key: JSON.stringify([ref.environmentId, ref.threadId, summary.runId]),
        scope,
        summary,
      };
      const stored = await transaction(scope, "readwrite", (rows, store) => {
        const next = rows
          .filter(({ key }) => key !== row.key)
          .concat(row)
          .sort((a, b) => byNewest(a.summary, b.summary));
        for (const stale of next.slice(LIMIT)) if (stale.key !== row.key) store.delete(stale.key);
        if (next.slice(0, LIMIT).includes(row)) store.put(row);
        return true;
      });
      if (stored) {
        memory.get(scope)?.delete(summary.runId);
        return;
      }
      const rows = memory.get(scope) ?? new Map<string, RunSummary>();
      rows.set(summary.runId, summary);
      for (const stale of [...rows.values()].sort(byNewest).slice(LIMIT)) rows.delete(stale.runId);
      memory.set(scope, rows);
    },
  };
}
