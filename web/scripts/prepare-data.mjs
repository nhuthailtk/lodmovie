// Copies the pipeline output (../dist) and the YASGUI bundle into the app before dev/build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(web, "..", "dist");
const RDF_FILES = ["ontology.ttl", "data.nt", "links.nt", "void.ttl"];
const DOWNLOADS = [...RDF_FILES, "all.ttl.gz"];
const YASGUI = ["yasgui.min.js", "yasgui.min.css"];

const missing = DOWNLOADS.filter((file) => !existsSync(path.join(dist, file)));
if (missing.length) {
  console.error(`prepare-data: missing in ${dist}: ${missing.join(", ")}. Run "python -m pipeline.build" first.`);
  process.exit(1);
}

function copy(files, from, to) {
  mkdirSync(to, { recursive: true });
  for (const file of files) copyFileSync(path.join(from, file), path.join(to, file));
}

copy(RDF_FILES, dist, path.join(web, "data"));
copy(DOWNLOADS, dist, path.join(web, "public", "downloads"));
copy(YASGUI, path.join(web, "node_modules", "@zazuko", "yasgui", "build"), path.join(web, "public", "vendor", "yasgui"));
console.log(`prepare-data: ${RDF_FILES.length} RDF files, ${DOWNLOADS.length} downloads and the YASGUI bundle are in place`);
