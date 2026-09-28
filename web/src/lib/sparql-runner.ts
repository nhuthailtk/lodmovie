import path from "node:path";
import { Worker } from "node:worker_threads";
import { STORE_FILES } from "./store";

/** Queries longer than this are killed; stays under the function's 10 s maxDuration. */
export const QUERY_TIMEOUT_MS = 8000;

export class QueryTimeout extends Error {}

type Pending = { resolve: (body: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function failAll(error: Error) {
  for (const [id, job] of pending) {
    clearTimeout(job.timer);
    job.reject(error);
    pending.delete(id);
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(path.join(process.cwd(), "sparql-worker", "worker.mjs"), {
    workerData: { dir: path.join(process.cwd(), "data"), files: STORE_FILES },
  });
  created.on("message", ({ id, body, error }: { id: number; body?: string; error?: string }) => {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    clearTimeout(job.timer);
    if (error === undefined) job.resolve(body ?? "");
    else job.reject(new Error(error));
  });
  created.on("error", (error) => failAll(error));
  created.on("exit", () => {
    if (worker === created) worker = null;
    failAll(new QueryTimeout());
  });
  created.unref();
  worker = created;
  return created;
}

/** Run one public query in the worker; a query over the time limit kills the worker (a fresh one starts next time). */
export function runInWorker(query: string, format: string): Promise<string> {
  const current = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (worker === current) worker = null;
      void current.terminate();
    }, QUERY_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    current.postMessage({ id, query, format });
  });
}
