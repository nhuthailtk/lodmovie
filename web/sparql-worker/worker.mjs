// Runs public SPARQL queries off the main thread, so a runaway query can be cut off without freezing the site.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import oxigraph from "oxigraph";

const store = new oxigraph.Store();
for (const [file, format, graph] of workerData.files) {
  store.load(readFileSync(path.join(workerData.dir, file), "utf8"), { format, to_graph_name: oxigraph.namedNode(graph) });
}

parentPort.on("message", ({ id, query, format }) => {
  try {
    const body = store.query(query, { use_default_graph_as_union: true, results_format: format });
    parentPort.postMessage({ id, body });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
