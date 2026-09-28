# LOD Movie Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js site in `web/` that serves the LOD Movie dataset (`dist/`) as Linked Data with a SPARQL 1.1 endpoint, browse/search pages, resource pages with a live Wikidata panel, an ontology diagram, a triple explorer and dataset docs, deployed on Vercel.

**Architecture:** Next.js 16 App Router (Node runtime). One in-memory Oxigraph store (WebAssembly) per server instance, loaded from `web/data/` (copied from `../dist` by a prebuild script) into four named graphs. `src/proxy.ts` gives `/sparql`, `/ontology` and `/dataset` two audiences (HTML page vs RDF/SPARQL route handler). `/resource/...` answers `303 See Other`. Server components query the store directly; client components (YASGUI, Cytoscape, Wikidata panel) run in the browser.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Tailwind CSS 4, oxigraph 0.5.11, sparqljs 3, cytoscape 3.34, @zazuko/yasgui 4.6 (loaded as a static bundle).

**Spec:** `docs/superpowers/specs/2026-09-28-lod-movie-website-design.md`

## Global Constraints

- Base URI `https://lod-movie.felix-nguyen.io.vn/`; resource IRIs `…/resource/{movie|person|genre|profession|credit|scheme}/{id}`, ids match `^[A-Za-z0-9-]+$`.
- Named graphs: `…/graph/data`, `…/graph/links`, `…/graph/ontology`, `…/graph/void`; every query runs with `use_default_graph_as_union: true`.
- RDF media types ↔ extensions: `text/turtle`↔`ttl`, `application/ld+json`↔`jsonld`, `application/n-triples`↔`nt`, `application/rdf+xml`↔`rdf`. Negotiated responses send `Vary: Accept`; ties prefer HTML.
- SPARQL endpoint: read-only, `LIMIT 10000` injected when missing or larger (header `X-LOD-Result-Limit: 10000`), responses > 4 MB → `413`, `maxDuration = 10`, CORS `*`.
- UI in English only; Vietnamese title shown on movie pages.
- **No automated tests and no smoke script** (user decision, spec §8). Every task is verified with `npm run build` and manual `curl`/browser checks against `npm start`.
- User-supplied text in SPARQL goes through `lit()` (JSON escaping) and IRIs through `iriRef()` (rejects unsafe characters); never string-concatenate raw input.
- Oxigraph serialises Turtle without `@prefix` declarations (valid Turtle); the hand-written `ontology.ttl`/`void.ttl` are served verbatim when Turtle is requested for `/ontology` and `/dataset`.
- Commands run from `d:/KHDL/semantic-web/code/web` unless stated; Git Bash on Windows.

## Review Focus

- Real-world `Accept` headers: browsers (`text/html,…,*/*;q=0.8`), curl (`*/*`), rdflib (`application/rdf+xml, text/rdf+n3, …`), `text/turtle;q=0.9, */*;q=0.1` → the right 303 target → Task 2 manual checks.
- YASGUI POSTs form-encoded queries to `/sparql`; the proxy rewrite must preserve method and body → Task 3 and Task 8 checks.
- Search text with quotes, backslashes or Unicode (`"`, `\`, `O'Brien`, `Công viên`) must not break SPARQL → Task 5 checks.
- Unknown or malformed resources (`/page/person/nm9999999`, `/resource/foo/bar`, `/data/movie/x.exe`) → `404`, never `500` → Task 7 checks.
- Non-ASCII IRIs and Vietnamese labels render correctly in HTML and in JSON-LD/Turtle → Task 7 checks.

## Starting and stopping the production server (used by every task)

```bash
npm run build > ../.superpowers/web-build.log 2>&1; echo "build exit=$?"; tail -30 ../.superpowers/web-build.log
(npx next start -p 3100 > ../.superpowers/web-start.log 2>&1 &) ; sleep 6
# … curl checks …
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
```

---

## File Structure

| File | Responsibility |
|---|---|
| `web/scripts/prepare-data.mjs` | Copy `../dist` RDF files to `web/data`, downloads to `web/public/downloads`, YASGUI bundle to `web/public/vendor/yasgui` |
| `web/next.config.ts` | External packages (oxigraph, sparqljs), trace `data/**` into every function |
| `web/src/proxy.ts` | HTML-vs-machine rewrites for `/sparql`, `/ontology`, `/dataset` |
| `web/src/lib/config.ts` | Base URI, graphs, prefixes, limits |
| `web/src/lib/rdf.ts` | Term types, IRI helpers, prefix handling, SPARQL escaping, `sparqlHref` |
| `web/src/lib/store.ts` | Oxigraph singleton and `select`/`ask`/`serialize` |
| `web/src/lib/conneg.ts` | Accept parsing, RDF negotiation |
| `web/src/lib/linked-data.ts` | `exists`, `describe` |
| `web/src/lib/sparql.ts` | Endpoint logic: parse, limit, format, run |
| `web/src/lib/queries.ts` | Browse/search/stats queries and shared card types |
| `web/src/lib/examples.ts` | Example SPARQL queries |
| `web/src/lib/resource.ts` | Data for movie/person/concept/credit/generic pages |
| `web/src/lib/wikidata.ts` | Live Wikidata facts |
| `web/src/lib/ontology.ts` | Ontology terms, header and diagram model |
| `web/src/lib/graph.ts` | Neighbourhood of a resource for the explorer |
| `web/src/components/*` | UI: layout pieces, cards, term rendering, views, client widgets |
| `web/src/app/**` | Pages and route handlers (see spec §4.2) |

---

### Task 1: Scaffold `web/` and data preparation

**Files:**
- Create: `web/` (create-next-app), `web/scripts/prepare-data.mjs`
- Modify: `web/next.config.ts`, `web/package.json` (scripts), `web/.gitignore`, `.gitignore` (repo root)

**Interfaces:**
- Produces: `web/data/{ontology.ttl,data.nt,links.nt,void.ttl}`, `web/public/downloads/{…,all.ttl.gz}`, `web/public/vendor/yasgui/yasgui.min.{js,css}` after `npm run build`/`npm run dev`.

- [ ] **Step 1: Scaffold the app and install dependencies**

```bash
cd d:/KHDL/semantic-web/code
npx --yes create-next-app@16 web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
cd web
npm install oxigraph@0.5.11 sparqljs@3 cytoscape@3 @zazuko/yasgui@4
npm install -D @types/sparqljs
rm -f public/*.svg src/app/favicon.ico
```

- [ ] **Step 2: Write the data preparation script**

File: `web/scripts/prepare-data.mjs`
```js
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
```

- [ ] **Step 3: Configure Next.js, scripts and ignores**

File: `web/next.config.ts`
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Oxigraph ships a WebAssembly binary; keep it (and sparqljs) as plain Node modules.
  serverExternalPackages: ["oxigraph", "sparqljs"],
  // The RDF files are read from disk at runtime, so every server function must include them.
  outputFileTracingIncludes: { "/*": ["./data/**/*"], "/**/*": ["./data/**/*"] },
};

export default nextConfig;
```

In `web/package.json` add to `"scripts"`:
```json
"predev": "node scripts/prepare-data.mjs",
"prebuild": "node scripts/prepare-data.mjs",
```

Append to `web/.gitignore`:
```
# generated by scripts/prepare-data.mjs
/data
/public/downloads
/public/vendor
```

Append to the repo-root `.gitignore`:
```
web/node_modules/
web/.next/
```

- [ ] **Step 4: Build and check the copied files**

Run: `npm run build > ../.superpowers/web-build.log 2>&1; echo "exit=$?"; grep prepare-data ../.superpowers/web-build.log; ls data public/downloads public/vendor/yasgui`
Expected: `exit=0`, the prepare-data line, and all listed files present.

- [ ] **Step 5: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add .gitignore web && git commit -m "feat(web): scaffold Next.js app and data preparation"
```

---

### Task 2: Store, content negotiation and Linked Data routes

**Files:**
- Create: `web/src/lib/config.ts`, `web/src/lib/rdf.ts`, `web/src/lib/store.ts`, `web/src/lib/conneg.ts`, `web/src/lib/linked-data.ts`, `web/src/app/resource/[type]/[id]/route.ts`, `web/src/app/data/[type]/[file]/route.ts`, `web/src/app/api/rdf/[doc]/route.ts`, `web/src/proxy.ts`

**Interfaces:**
- Produces: `config.*` constants; `rdf.Term`, `rdf.Row`, `resourceIri(type,id): string|null`, `resourcePath(iri)`, `pageHref(iri): string|null`, `shorten(iri)`, `lit(s)`, `iriRef(iri)`, `isSafeIri(iri)`, `localName(iri)`, `withPrefixes(query)`, `sparqlHref(query)`, `asNumber(t)`, `asString(t)`; `store.getStore()`, `select(q): Row[]`, `ask(q): boolean`, `serialize(q, mime): string`; `conneg.RDF_TYPES`, `RdfExt`, `isRdfExt`, `parseAccept`, `negotiateRdf(accept): RdfExt|null`; `linked-data.exists(iri)`, `describe(iri, mime): string|null`.

- [ ] **Step 1: Write the core libraries**

File: `web/src/lib/config.ts`
```ts
export const BASE = "https://lod-movie.felix-nguyen.io.vn/";
export const RESOURCE = `${BASE}resource/`;
export const ONTOLOGY = `${BASE}ontology`;
export const MO = `${ONTOLOGY}#`;
export const DATASET = `${BASE}dataset`;

export const GRAPH = {
  data: `${BASE}graph/data`,
  links: `${BASE}graph/links`,
  ontology: `${BASE}graph/ontology`,
  void: `${BASE}graph/void`,
} as const;

export const PREFIXES: Record<string, string> = {
  mo: MO,
  movie: `${RESOURCE}movie/`,
  person: `${RESOURCE}person/`,
  genre: `${RESOURCE}genre/`,
  profession: `${RESOURCE}profession/`,
  credit: `${RESOURCE}credit/`,
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  schema: "https://schema.org/",
  foaf: "http://xmlns.com/foaf/0.1/",
  dcterms: "http://purl.org/dc/terms/",
  dcat: "http://www.w3.org/ns/dcat#",
  void: "http://rdfs.org/ns/void#",
  dbo: "http://dbpedia.org/ontology/",
  dbr: "http://dbpedia.org/resource/",
  wd: "http://www.wikidata.org/entity/",
};

export const RESOURCE_TYPES = ["movie", "person", "genre", "profession", "credit", "scheme"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESULT_LIMIT = 10_000;
export const MAX_RESPONSE_BYTES = 4_000_000;
export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
export const USER_AGENT = "lod-movie-capstone/1.0 (https://lod-movie.felix-nguyen.io.vn/; semantic-web student project)";
```

File: `web/src/lib/rdf.ts`
```ts
import { DATASET, MO, ONTOLOGY, PREFIXES, RESOURCE, RESOURCE_TYPES, type ResourceType } from "./config";

export type Term = { type: "uri" | "literal" | "bnode"; value: string; lang?: string; datatype?: string };
export type Row = Record<string, Term | undefined>;

const ID = /^[A-Za-z0-9-]+$/;
const SAFE_IRI = /^https?:\/\/[^\s<>"{}|\\^`]+$/;

export function resourceIri(type: string, id: string): string | null {
  if (!(RESOURCE_TYPES as readonly string[]).includes(type) || !ID.test(id)) return null;
  return `${RESOURCE}${type}/${id}`;
}

export function resourcePath(iri: string): { type: ResourceType; id: string } | null {
  if (!iri.startsWith(RESOURCE)) return null;
  const [type, id, ...rest] = iri.slice(RESOURCE.length).split("/");
  if (rest.length || !resourceIri(type, id ?? "")) return null;
  return { type: type as ResourceType, id };
}

/** Where a browser should go for this IRI inside the site, or null if it is external. */
export function pageHref(iri: string): string | null {
  const local = resourcePath(iri);
  if (local) return `/page/${local.type}/${local.id}`;
  if (iri.startsWith(MO)) return `/ontology#${iri.slice(MO.length)}`;
  if (iri === ONTOLOGY) return "/ontology";
  if (iri === DATASET) return "/dataset";
  return null;
}

export function shorten(iri: string): string {
  let best = "";
  for (const [prefix, ns] of Object.entries(PREFIXES)) {
    if (iri.startsWith(ns) && ns.length > (best ? PREFIXES[best].length : 0)) best = prefix;
  }
  return best ? `${best}:${iri.slice(PREFIXES[best].length)}` : iri;
}

export function localName(iri: string): string {
  return iri.split(/[/#]/).pop() ?? iri;
}

/** A SPARQL string literal; JSON escaping is valid SPARQL escaping. */
export function lit(value: string): string {
  return JSON.stringify(value);
}

export function isSafeIri(iri: string): boolean {
  return SAFE_IRI.test(iri);
}

export function iriRef(iri: string): string {
  if (!isSafeIri(iri)) throw new Error(`unsafe IRI: ${iri}`);
  return `<${iri}>`;
}

/** Prepend PREFIX declarations for every known prefix the query uses and does not declare itself. */
export function withPrefixes(query: string): string {
  const used = Object.keys(PREFIXES).filter(
    (p) => new RegExp(`(^|[\\s({\\[/^|,;!])${p}:`).test(query) && !new RegExp(`PREFIX\\s+${p}:`, "i").test(query),
  );
  return [...used.map((p) => `PREFIX ${p}: <${PREFIXES[p]}>`), query.trim()].join("\n");
}

/** Link that opens a query in the SPARQL editor. */
export function sparqlHref(query: string): string {
  return `/sparql?q=${encodeURIComponent(withPrefixes(query))}`;
}

export const asNumber = (t?: Term) => (t ? Number(t.value) : undefined);
export const asString = (t?: Term) => t?.value || undefined;
```

File: `web/src/lib/store.ts`
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import oxigraph from "oxigraph";
import { GRAPH } from "./config";
import { withPrefixes, type Row, type Term } from "./rdf";

const FILES = [
  ["data.nt", "application/n-triples", GRAPH.data],
  ["links.nt", "application/n-triples", GRAPH.links],
  ["ontology.ttl", "text/turtle", GRAPH.ontology],
  ["void.ttl", "text/turtle", GRAPH.void],
] as const;

const OPTIONS = { use_default_graph_as_union: true };

let store: oxigraph.Store | null = null;

/** The whole dataset in one in-memory Oxigraph store, one named graph per dist file. */
export function getStore(): oxigraph.Store {
  if (store) return store;
  const loaded = new oxigraph.Store();
  const dir = path.join(process.cwd(), "data");
  for (const [file, format, graph] of FILES) {
    loaded.load(readFileSync(path.join(dir, file), "utf8"), { format, to_graph_name: oxigraph.namedNode(graph) });
  }
  store = loaded;
  return store;
}

function toTerm(term: oxigraph.Term): Term {
  if (term.termType === "NamedNode") return { type: "uri", value: term.value };
  if (term.termType === "Literal") {
    return { type: "literal", value: term.value, lang: term.language || undefined, datatype: term.datatype.value };
  }
  return { type: "bnode", value: term.value };
}

export function select(query: string): Row[] {
  const rows = getStore().query(withPrefixes(query), OPTIONS) as Map<string, oxigraph.Term>[];
  return rows.map((binding) => Object.fromEntries([...binding.entries()].map(([name, term]) => [name, toTerm(term)])));
}

export function ask(query: string): boolean {
  return getStore().query(withPrefixes(query), OPTIONS) as boolean;
}

export function serialize(query: string, format: string): string {
  return getStore().query(withPrefixes(query), { ...OPTIONS, results_format: format }) as string;
}
```

File: `web/src/lib/conneg.ts`
```ts
export const RDF_TYPES = {
  ttl: "text/turtle",
  jsonld: "application/ld+json",
  nt: "application/n-triples",
  rdf: "application/rdf+xml",
} as const;
export type RdfExt = keyof typeof RDF_TYPES;

export type Accepted = { type: string; q: number };

const HTML = new Set(["text/html", "application/xhtml+xml"]);

export function isRdfExt(ext: string): ext is RdfExt {
  return Object.hasOwn(RDF_TYPES, ext);
}

export function parseAccept(header: string | null): Accepted[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [type, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { type: type.trim(), q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((a) => a.type && a.q > 0);
}

/** The RDF format the client prefers, or null when it should get HTML. At equal q, HTML wins. */
export function negotiateRdf(header: string | null): RdfExt | null {
  const accepted = parseAccept(header);
  const levels = [...new Set(accepted.map((a) => a.q))].sort((a, b) => b - a);
  for (const q of levels) {
    const group = accepted.filter((a) => a.q === q).map((a) => a.type);
    if (group.some((type) => HTML.has(type))) return null;
    const rdf = (Object.entries(RDF_TYPES) as [RdfExt, string][]).find(([, type]) => group.includes(type));
    if (rdf) return rdf[0];
    if (group.some((type) => type === "*/*" || type === "text/*")) return null;
  }
  return null;
}
```

File: `web/src/lib/linked-data.ts`
```ts
import { iriRef } from "./rdf";
import { ask, serialize } from "./store";

export function exists(iri: string): boolean {
  return ask(`ASK { ${iriRef(iri)} ?p ?o }`);
}

/** The resource's own triples plus up to 500 incoming ones, serialised as `format`. */
export function describe(iri: string, format: string): string | null {
  if (!exists(iri)) return null;
  const r = iriRef(iri);
  return serialize(
    `CONSTRUCT { ${r} ?p ?o . ?s ?q ${r} } WHERE { { ${r} ?p ?o } UNION { SELECT ?s ?q WHERE { ?s ?q ${r} } LIMIT 500 } }`,
    format,
  );
}
```

- [ ] **Step 2: Write the Linked Data routes and the proxy**

File: `web/src/app/resource/[type]/[id]/route.ts`
```ts
import { negotiateRdf } from "@/lib/conneg";
import { exists } from "@/lib/linked-data";
import { resourceIri } from "@/lib/rdf";

/** The Linked Data URI: 303 See Other to the HTML page or to the RDF document ("Cool URIs"). */
export async function GET(req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const iri = resourceIri(type, id);
  if (!iri || !exists(iri)) {
    return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const ext = negotiateRdf(req.headers.get("accept"));
  const location = ext ? `/data/${type}/${id}.${ext}` : `/page/${type}/${id}`;
  return new Response(null, {
    status: 303,
    headers: { Location: location, Vary: "Accept", "Access-Control-Allow-Origin": "*" },
  });
}
```

File: `web/src/app/data/[type]/[file]/route.ts`
```ts
import { isRdfExt, RDF_TYPES } from "@/lib/conneg";
import { describe } from "@/lib/linked-data";
import { resourceIri } from "@/lib/rdf";

const notFound = () => new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** The RDF document describing one resource, e.g. /data/movie/tt0107290.ttl */
export async function GET(_req: Request, { params }: { params: Promise<{ type: string; file: string }> }) {
  const { type, file } = await params;
  const dot = file.lastIndexOf(".");
  const ext = file.slice(dot + 1);
  const iri = dot > 0 ? resourceIri(type, file.slice(0, dot)) : null;
  if (!iri || !isRdfExt(ext)) return notFound();
  const body = describe(iri, RDF_TYPES[ext]);
  if (body === null) return notFound();
  return new Response(body, {
    headers: { "Content-Type": `${RDF_TYPES[ext]}; charset=utf-8`, "Access-Control-Allow-Origin": "*" },
  });
}
```

File: `web/src/app/api/rdf/[doc]/route.ts`
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import oxigraph from "oxigraph";
import { GRAPH } from "@/lib/config";
import { isRdfExt, RDF_TYPES } from "@/lib/conneg";
import { getStore } from "@/lib/store";

const DOCS = {
  ontology: { graph: GRAPH.ontology, file: "ontology.ttl" },
  dataset: { graph: GRAPH.void, file: "void.ttl" },
} as const;

/** RDF for the ontology and dataset URIs; reached through the proxy when a client asks for RDF. */
export async function GET(req: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const format = new URL(req.url).searchParams.get("format") ?? "ttl";
  if (!Object.hasOwn(DOCS, doc) || !isRdfExt(format)) return new Response("Not found\n", { status: 404 });
  const { graph, file } = DOCS[doc as keyof typeof DOCS];
  const body =
    format === "ttl"
      ? readFileSync(path.join(process.cwd(), "data", file), "utf8")
      : getStore().dump({ format: RDF_TYPES[format], from_graph_name: oxigraph.namedNode(graph) });
  return new Response(body, {
    headers: {
      "Content-Type": `${RDF_TYPES[format]}; charset=utf-8`,
      Vary: "Accept",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
```

File: `web/src/proxy.ts`
```ts
import { NextResponse, type NextRequest } from "next/server";
import { negotiateRdf } from "@/lib/conneg";

/** One URL, two audiences: /sparql, /ontology and /dataset serve HTML to browsers and RDF or SPARQL results to machines. */
export function proxy(request: NextRequest) {
  const { pathname, searchParams, search } = request.nextUrl;
  if (pathname === "/sparql") {
    if (request.method === "GET" && !searchParams.has("query")) return NextResponse.next();
    return NextResponse.rewrite(new URL(`/api/sparql${search}`, request.url));
  }
  const ext = negotiateRdf(request.headers.get("accept"));
  const response = ext
    ? NextResponse.rewrite(new URL(`/api/rdf${pathname}?format=${ext}`, request.url))
    : NextResponse.next();
  response.headers.set("Vary", "Accept");
  return response;
}

export const config = { matcher: ["/sparql", "/ontology", "/dataset"] };
```

- [ ] **Step 3: Build, start and check the Linked Data behaviour**

Run the build and start commands from "Starting and stopping the production server", then:
```bash
B=http://localhost:3100
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "Accept: text/html,application/xhtml+xml,*/*;q=0.8" $B/resource/movie/tt0107290
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "Accept: text/turtle" $B/resource/movie/tt0107290
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "Accept: application/rdf+xml, text/rdf+n3;q=0.9" $B/resource/person/nm0000229
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "Accept: text/turtle;q=0.9, */*;q=0.1" $B/resource/genre/sci-fi
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $B/resource/movie/tt0107290
curl -s -o /dev/null -w "%{http_code}\n" $B/resource/foo/bar $B/resource/movie/tt9999999 $B/data/movie/tt0107290.exe
curl -s $B/data/movie/tt0107290.ttl | head -5
curl -s $B/data/movie/tt0107290.jsonld | head -c 300; echo
curl -s -D - -o /dev/null -H "Accept: text/turtle" $B/ontology | grep -i "content-type\|vary"
curl -s -H "Accept: application/ld+json" $B/dataset | head -c 200; echo
```
Expected: `303 …/page/movie/tt0107290`, `303 …/data/movie/tt0107290.ttl`, `303 …/data/person/nm0000229.rdf`, `303 …/data/genre/sci-fi.ttl`, `303 …/page/movie/tt0107290` (curl `*/*` → HTML); three `404`; Turtle and JSON-LD triples about Jurassic Park including the `@vi` label; `Content-Type: text/turtle` with `Vary: Accept`; JSON-LD of the VoID graph. (`/page/…` itself is built in Task 7.) Stop the server.

- [ ] **Step 4: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): Oxigraph store, content negotiation and Linked Data routes"
```

---

### Task 3: SPARQL endpoint

**Files:**
- Create: `web/src/lib/sparql.ts`, `web/src/app/api/sparql/route.ts`

**Interfaces:**
- Consumes: `store.getStore`, `conneg.parseAccept`, `conneg.RDF_TYPES`, `config.RESULT_LIMIT`, `config.MAX_RESPONSE_BYTES`.
- Produces: `RESULT_TYPES`, `SparqlError(message, status)`, `prepareQuery(text): {query, form, limited}`, `runQuery(text, accept, format): {body, contentType, limited}`; route `/api/sparql` (GET/POST/OPTIONS) reached via `/sparql`.

- [ ] **Step 1: Write the endpoint logic**

File: `web/src/lib/sparql.ts`
```ts
import { Generator, Parser } from "sparqljs";
import { MAX_RESPONSE_BYTES, RESULT_LIMIT } from "./config";
import { parseAccept, RDF_TYPES } from "./conneg";
import { getStore } from "./store";

export const RESULT_TYPES = {
  json: "application/sparql-results+json",
  xml: "application/sparql-results+xml",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
} as const;

export class SparqlError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Form = "SELECT" | "ASK" | "CONSTRUCT" | "DESCRIBE";
export type Prepared = { query: string; form: Form; limited: boolean };
export type SparqlResult = { body: string; contentType: string; limited: boolean };

/** Parse the query, refuse updates, and cap the result size with LIMIT. */
export function prepareQuery(text: string): Prepared {
  let parsed;
  try {
    parsed = new Parser().parse(text);
  } catch (error) {
    throw new SparqlError(`SPARQL syntax error: ${(error as Error).message}`, 400);
  }
  if (parsed.type === "update") {
    throw new SparqlError("This endpoint is read-only: SPARQL UPDATE is not allowed.", 400);
  }
  const form = parsed.queryType as Form;
  if (form === "ASK" || (parsed.limit !== undefined && parsed.limit <= RESULT_LIMIT)) {
    return { query: text, form, limited: false };
  }
  parsed.limit = RESULT_LIMIT;
  return { query: new Generator().stringify(parsed), form, limited: true };
}

function chooseType(form: Form, accept: string | null, format: string | null): string {
  const table: Record<string, string> = form === "SELECT" || form === "ASK" ? RESULT_TYPES : RDF_TYPES;
  if (format) {
    if (!Object.hasOwn(table, format)) {
      throw new SparqlError(`format "${format}" is not available for ${form}; use one of: ${Object.keys(table).join(", ")}`, 400);
    }
    return table[format];
  }
  const offered = Object.values(table);
  for (const { type } of parseAccept(accept).sort((a, b) => b.q - a.q)) {
    if (offered.includes(type)) return type;
    if (type === "application/json" && table === RESULT_TYPES) return RESULT_TYPES.json;
  }
  return offered[0];
}

export function runQuery(text: string, accept: string | null, format: string | null): SparqlResult {
  const prepared = prepareQuery(text);
  const contentType = chooseType(prepared.form, accept, format);
  let body: string;
  try {
    body = getStore().query(prepared.query, { use_default_graph_as_union: true, results_format: contentType }) as string;
  } catch (error) {
    throw new SparqlError(`Query failed: ${error instanceof Error ? error.message : String(error)}`, 400);
  }
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    throw new SparqlError(`The result is larger than ${MAX_RESPONSE_BYTES / 1_000_000} MB. Add a LIMIT or narrow the query.`, 413);
  }
  return { body, contentType, limited: prepared.limited };
}
```

- [ ] **Step 2: Write the route handler**

File: `web/src/app/api/sparql/route.ts`
```ts
import { RESULT_LIMIT } from "@/lib/config";
import { runQuery, SparqlError } from "@/lib/sparql";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Expose-Headers": "X-LOD-Result-Limit",
};

function fail(status: number, message: string): Response {
  return new Response(`${message}\n`, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
}

function answer(req: Request, query: string | null, params: URLSearchParams): Response {
  if (params.has("default-graph-uri") || params.has("named-graph-uri")) {
    return fail(400, "default-graph-uri and named-graph-uri are not supported; use GRAPH <…> in the query (graphs: …/graph/data, …/graph/links, …/graph/ontology, …/graph/void).");
  }
  if (!query?.trim()) return fail(400, "Missing 'query' parameter. Open /sparql in a browser for the query editor.");
  try {
    const result = runQuery(query, req.headers.get("accept"), params.get("format"));
    const headers: Record<string, string> = {
      ...CORS,
      "Content-Type": `${result.contentType}; charset=utf-8`,
      Vary: "Accept",
    };
    if (result.limited) headers["X-LOD-Result-Limit"] = String(RESULT_LIMIT);
    return new Response(result.body, { headers });
  } catch (error) {
    if (error instanceof SparqlError) return fail(error.status, error.message);
    throw error;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return answer(req, url.searchParams.get("query"), url.searchParams);
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/sparql-query") return answer(req, await req.text(), url.searchParams);
  if (type === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(await req.text());
    for (const [key, value] of url.searchParams) if (!form.has(key)) form.set(key, value);
    return answer(req, form.get("query"), form);
  }
  return fail(415, "POST the query as application/x-www-form-urlencoded (query=…) or as application/sparql-query.");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
```

- [ ] **Step 3: Build, start and check the protocol**

Run the build and start commands, then:
```bash
B=http://localhost:3100/sparql
Q='SELECT ?m ?t WHERE { ?m a <https://lod-movie.felix-nguyen.io.vn/ontology#Movie> ; <http://www.w3.org/2000/01/rdf-schema#label> ?t } LIMIT 2'
curl -s -G --data-urlencode "query=$Q" $B | head -c 250; echo
curl -s -H "Accept: text/csv" --data-urlencode "query=$Q" $B
curl -s -X POST -H "Content-Type: application/sparql-query" -H "Accept: application/sparql-results+xml" --data "$Q" $B | head -c 200; echo
curl -s -D - -o /dev/null -G --data-urlencode "query=SELECT * WHERE { ?s ?p ?o }" $B | grep -i "x-lod-result-limit\|content-type"
curl -s -G --data-urlencode "query=CONSTRUCT WHERE { ?s a <https://lod-movie.felix-nguyen.io.vn/ontology#Genre> } LIMIT 3" -H "Accept: application/ld+json" $B | head -c 200; echo
curl -s -G --data-urlencode "query=ASK { ?s ?p ?o }" $B; echo
curl -s -w " %{http_code}\n" --data-urlencode "query=INSERT DATA { <http://a> <http://b> <http://c> }" $B
curl -s -w " %{http_code}\n" -G --data-urlencode "query=SELEKT nope" $B
curl -s -w " %{http_code}\n" -G --data-urlencode "query=$Q" --data-urlencode "format=ttl" $B
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS $B
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" -H "Accept: text/html" http://localhost:3100/sparql
```
Expected: JSON bindings; CSV with header `m,t`; SPARQL XML; `X-LOD-Result-Limit: 10000` and JSON content type; JSON-LD; `{"head":{},"boolean":true}`; `…read-only… 400`; `SPARQL syntax error… 400`; `format "ttl" is not available for SELECT… 400`; `204`; the last line is `404` until the `/sparql` page exists (Task 8). Stop the server.

- [ ] **Step 4: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): SPARQL 1.1 protocol endpoint with result limits and CORS"
```

---

### Task 4: Layout, shared UI, home and search

**Files:**
- Create: `web/src/lib/queries.ts`, `web/src/lib/examples.ts`, `web/src/components/ui.tsx`, `web/src/components/term.tsx`, `web/src/components/copy-button.tsx`, `web/src/components/movie-card.tsx`, `web/src/app/search/page.tsx`, `web/src/app/not-found.tsx`
- Modify (replace): `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/src/app/page.tsx`

**Interfaces:**
- Produces: `queries.SearchParams`, `Named`, `MovieCard`, `PersonCard`, `toCard(row)`, `MOVIES_PER_PAGE`, `PEOPLE_PER_PAGE`, `MovieFilters`, `PeopleFilters`, `parseMovieFilters(sp)`, `parsePeopleFilters(sp)`, `listMovies(f, limit?) → {rows,total,query}`, `listPeople(f, limit?) → {rows,total,query}`, `genreOptions()`, `professionOptions()`, `datasetStats()`, `voidMeta()`; `examples.EXAMPLES: {title, description, query}[]`; components `PageHeader`, `Section`, `Stat`, `Chip`, `Facts`, `ExternalLink`, `Empty`, `TermValue`, `CopyButton` (default), `MovieCard` (default).

- [ ] **Step 1: Write queries and examples**

File: `web/src/lib/queries.ts`
```ts
import { DATASET, GRAPH } from "./config";
import { asNumber, asString, iriRef, lit, localName, withPrefixes, type Row } from "./rdf";
import { select } from "./store";

export type SearchParams = Record<string, string | string[] | undefined>;
export type Named = { iri: string; label: string };
export type MovieCard = { iri: string; title: string; vi?: string; year?: number; rating?: number; genres?: string };
export type PersonCard = Named & { movies: number };

export const MOVIES_PER_PAGE = 24;
export const PEOPLE_PER_PAGE = 48;

const MOVIE_SORTS = {
  rating: "DESC(?rating) DESC(?votes)",
  votes: "DESC(?votes)",
  year: "DESC(?year) ?title",
  title: "?title",
} as const;
export type MovieSort = keyof typeof MOVIE_SORTS;
export type MovieFilters = { q: string; genre: string; from?: number; to?: number; rating?: number; sort: MovieSort; page: number };
export type PeopleFilters = { q: string; profession: string; sort: "movies" | "name"; page: number };

const SLUG = /^[a-z0-9-]*$/;

function param(sp: SearchParams, key: string): string {
  const value = sp[key];
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

function numberParam(sp: SearchParams, key: string): number | undefined {
  const raw = param(sp, key);
  const value = Number(raw);
  return raw && Number.isFinite(value) ? value : undefined;
}

function pageParam(sp: SearchParams): number {
  return Math.max(1, Math.floor(numberParam(sp, "page") ?? 1));
}

export function parseMovieFilters(sp: SearchParams): MovieFilters {
  const sort = param(sp, "sort");
  const genre = param(sp, "genre");
  return {
    q: param(sp, "q").slice(0, 100),
    genre: SLUG.test(genre) ? genre : "",
    from: numberParam(sp, "from"),
    to: numberParam(sp, "to"),
    rating: numberParam(sp, "rating"),
    sort: Object.hasOwn(MOVIE_SORTS, sort) ? (sort as MovieSort) : "rating",
    page: pageParam(sp),
  };
}

export function parsePeopleFilters(sp: SearchParams): PeopleFilters {
  const profession = param(sp, "profession");
  return {
    q: param(sp, "q").slice(0, 100),
    profession: SLUG.test(profession) ? profession : "",
    sort: param(sp, "sort") === "name" ? "name" : "movies",
    page: pageParam(sp),
  };
}

export function toCard(row: Row): MovieCard {
  return {
    iri: row.iri!.value,
    title: row.title!.value,
    vi: asString(row.vi),
    year: asNumber(row.year),
    rating: asNumber(row.rating),
    genres: asString(row.genres),
  };
}

function movieWhere(f: MovieFilters): string {
  const lines = ["?iri a mo:Movie ; mo:primaryTitle ?pt ."];
  if (f.genre) lines.push(`?iri mo:hasGenre genre:${f.genre} .`);
  if (f.q) {
    lines.push(
      `FILTER EXISTS { ?iri rdfs:label|mo:primaryTitle|mo:originalTitle ?text . FILTER(CONTAINS(LCASE(STR(?text)), ${lit(f.q.toLowerCase())})) }`,
    );
  }
  lines.push("OPTIONAL { ?iri mo:releaseYear ?year }", "OPTIONAL { ?iri mo:averageRating ?rating }", "OPTIONAL { ?iri mo:numVotes ?votes }");
  if (f.from !== undefined) lines.push(`FILTER(?year >= ${Math.trunc(f.from)})`);
  if (f.to !== undefined) lines.push(`FILTER(?year <= ${Math.trunc(f.to)})`);
  if (f.rating !== undefined) lines.push(`FILTER(?rating >= ${f.rating})`);
  return lines.map((line) => `  ${line}`).join("\n");
}

export function listMovies(f: MovieFilters, limit = MOVIES_PER_PAGE) {
  const query = withPrefixes(`SELECT ?iri ?title ?vi ?year ?rating ?votes (GROUP_CONCAT(DISTINCT ?genreLabel; separator=", ") AS ?genres) WHERE {
${movieWhere(f)}
  OPTIONAL { ?iri rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?iri rdfs:label ?vi FILTER(LANG(?vi) = "vi") }
  OPTIONAL { ?iri mo:hasGenre/skos:prefLabel ?genreLabel }
  BIND(COALESCE(?en, ?pt) AS ?title)
}
GROUP BY ?iri ?title ?vi ?year ?rating ?votes
ORDER BY ${MOVIE_SORTS[f.sort]}
LIMIT ${limit} OFFSET ${(f.page - 1) * limit}`);
  const total = Number(select(`SELECT (COUNT(DISTINCT ?iri) AS ?n) WHERE {\n${movieWhere(f)}\n}`)[0]?.n?.value ?? 0);
  return { rows: select(query).map(toCard), total, query };
}

function peopleWhere(f: PeopleFilters): string {
  const lines = ["?iri a mo:Person ; rdfs:label ?label ."];
  if (f.profession) lines.push(`?iri mo:primaryProfession profession:${f.profession} .`);
  if (f.q) lines.push(`FILTER(CONTAINS(LCASE(?label), ${lit(f.q.toLowerCase())}))`);
  return lines.map((line) => `  ${line}`).join("\n");
}

export function listPeople(f: PeopleFilters, limit = PEOPLE_PER_PAGE) {
  const order = f.sort === "name" ? "?label" : "DESC(?movies) ?label";
  const query = withPrefixes(`SELECT ?iri ?label (COUNT(DISTINCT ?movie) AS ?movies) WHERE {
${peopleWhere(f)}
  OPTIONAL { ?movie mo:hasActor|mo:directedBy|mo:writtenBy|mo:hasCredit/mo:creditedPerson ?iri }
}
GROUP BY ?iri ?label
ORDER BY ${order}
LIMIT ${limit} OFFSET ${(f.page - 1) * limit}`);
  const total = Number(select(`SELECT (COUNT(?iri) AS ?n) WHERE {\n${peopleWhere(f)}\n}`)[0]?.n?.value ?? 0);
  const rows: PersonCard[] = select(query).map((r) => ({ iri: r.iri!.value, label: r.label!.value, movies: Number(r.movies!.value) }));
  return { rows, total, query };
}

function options(query: string) {
  return select(query).map((r) => ({ slug: localName(r.iri!.value), label: r.label!.value, count: Number(r.n!.value) }));
}

export function genreOptions() {
  return options(`SELECT ?iri ?label (COUNT(DISTINCT ?m) AS ?n) WHERE { ?iri a mo:Genre ; skos:prefLabel ?label . ?m mo:hasGenre ?iri } GROUP BY ?iri ?label ORDER BY ?label`);
}

export function professionOptions() {
  return options(`SELECT ?iri ?label (COUNT(DISTINCT ?p) AS ?n) WHERE { ?iri a mo:Profession ; skos:prefLabel ?label . ?p mo:primaryProfession ?iri } GROUP BY ?iri ?label ORDER BY DESC(?n)`);
}

const VOID_G = iriRef(GRAPH.void);
const DS = iriRef(DATASET);

export function datasetStats() {
  const classes: Record<string, number> = Object.fromEntries(
    select(`SELECT ?class ?n WHERE { GRAPH ${VOID_G} { ${DS} void:classPartition ?part . ?part void:class ?class ; void:entities ?n } }`).map(
      (r) => [localName(r.class!.value), Number(r.n!.value)],
    ),
  );
  const triples = Number(select(`SELECT ?n WHERE { GRAPH ${VOID_G} { ${DS} void:triples ?n } }`)[0]?.n?.value ?? 0);
  const linksets = select(
    `SELECT ?target ?n WHERE { GRAPH ${VOID_G} { ${DS} void:subset ?ls . ?ls void:objectsTarget ?target ; void:triples ?n } } ORDER BY ?target`,
  ).map((r) => ({ target: r.target!.value, triples: Number(r.n!.value) }));
  const linkedMovies = Number(
    select(`SELECT (COUNT(DISTINCT ?m) AS ?n) WHERE { ?m a mo:Movie ; owl:sameAs ?x . FILTER(STRSTARTS(STR(?x), STR(wd:))) }`)[0]?.n?.value ?? 0,
  );
  return { classes, triples, linksets, linkedMovies, movies: classes.Movie ?? 0 };
}

export function voidMeta() {
  const rows = select(`SELECT ?p ?o WHERE { GRAPH ${VOID_G} { ${DS} ?p ?o } }`);
  const one = (local: string) => rows.find((r) => r.p!.value.endsWith(local))?.o?.value;
  return {
    title: one("/title"),
    description: one("/description"),
    license: one("/license"),
    modified: one("/modified"),
    version: one("#versionInfo"),
    sparql: one("#sparqlEndpoint"),
    sources: rows.filter((r) => r.p!.value.endsWith("/source")).map((r) => r.o!.value),
  };
}
```

File: `web/src/lib/examples.ts`
```ts
export type Example = { title: string; description: string; query: string };

const LINKS = "<https://lod-movie.felix-nguyen.io.vn/graph/links>";
const DATA = "<https://lod-movie.felix-nguyen.io.vn/graph/data>";
const DS = "<https://lod-movie.felix-nguyen.io.vn/dataset>";

/** Example queries shown in the SPARQL editor, on the home page and on the dataset page. */
export const EXAMPLES: Example[] = [
  {
    title: "Top-rated movies (English + Vietnamese titles)",
    description: "Language-tagged rdfs:label values in both languages.",
    query: `SELECT ?movie ?english ?vietnamese ?year ?rating WHERE {
  ?movie a mo:Movie ; mo:releaseYear ?year ; mo:averageRating ?rating ;
         rdfs:label ?english , ?vietnamese .
  FILTER(LANG(?english) = "en" && LANG(?vietnamese) = "vi")
}
ORDER BY DESC(?rating)
LIMIT 20`,
  },
  {
    title: "Sci-Fi movies by year",
    description: "Genres are SKOS concepts linked with mo:hasGenre.",
    query: `SELECT ?movie ?title ?year WHERE {
  ?movie mo:hasGenre genre:sci-fi ; mo:releaseYear ?year ; rdfs:label ?title .
  FILTER(LANG(?title) = "en")
}
ORDER BY ?year`,
  },
  {
    title: "Directors with more than one movie",
    description: "Aggregation over mo:directedBy.",
    query: `SELECT ?director ?name (COUNT(?movie) AS ?movies) (GROUP_CONCAT(?title; separator=" | ") AS ?titles) WHERE {
  ?movie mo:directedBy ?director ; rdfs:label ?title .
  ?director rdfs:label ?name .
  FILTER(LANG(?title) = "en")
}
GROUP BY ?director ?name
HAVING (COUNT(?movie) > 1)
ORDER BY DESC(?movies)`,
  },
  {
    title: "Cast of Jurassic Park with characters",
    description: "The n-ary mo:Credit pattern: movie → credit → person + role + character.",
    query: `SELECT ?order ?actor ?name ?character WHERE {
  movie:tt0107290 mo:hasCredit ?credit .
  ?credit mo:billingOrder ?order ; mo:creditedPerson ?actor ; mo:characterName ?character .
  ?actor rdfs:label ?name .
}
ORDER BY ?order`,
  },
  {
    title: "Most prolific actors",
    description: "Who appears in the most movies of the dataset.",
    query: `SELECT ?person ?name (COUNT(DISTINCT ?movie) AS ?movies) WHERE {
  ?movie mo:hasActor ?person .
  ?person rdfs:label ?name .
}
GROUP BY ?person ?name
ORDER BY DESC(?movies)
LIMIT 20`,
  },
  {
    title: "Movies linked to Wikidata and DBpedia (5★)",
    description: "Only the links named graph: owl:sameAs to other datasets.",
    query: `SELECT ?movie ?title ?wikidata ?dbpedia WHERE {
  ?movie a mo:Movie ; rdfs:label ?title .
  FILTER(LANG(?title) = "en")
  GRAPH ${LINKS} {
    ?movie owl:sameAs ?wikidata .
    FILTER(STRSTARTS(STR(?wikidata), STR(wd:)))
    OPTIONAL { ?movie owl:sameAs ?dbpedia . FILTER(STRSTARTS(STR(?dbpedia), STR(dbr:))) }
  }
}
LIMIT 50`,
  },
  {
    title: "Genres and their Wikidata/DBpedia matches",
    description: "SKOS mapping links (skos:exactMatch / skos:closeMatch).",
    query: `SELECT ?genre ?label ?relation ?match WHERE {
  ?genre a mo:Genre ; skos:prefLabel ?label .
  OPTIONAL { ?genre ?relation ?match . FILTER(?relation IN (skos:exactMatch, skos:closeMatch)) }
}
ORDER BY ?label`,
  },
  {
    title: "Property usage in the data",
    description: "How often each property is used in the instance data graph.",
    query: `SELECT ?property (COUNT(*) AS ?uses) WHERE {
  GRAPH ${DATA} { ?s ?property ?o }
}
GROUP BY ?property
ORDER BY DESC(?uses)`,
  },
  {
    title: "VoID class partitions",
    description: "Dataset statistics from the VoID description.",
    query: `SELECT ?class ?entities WHERE {
  ${DS} void:classPartition ?partition .
  ?partition void:class ?class ; void:entities ?entities .
}
ORDER BY DESC(?entities)`,
  },
  {
    title: "VoID linksets",
    description: "How many links go to each external dataset, and with which predicates.",
    query: `SELECT ?linkset ?target ?predicate ?triples WHERE {
  ${DS} void:subset ?linkset .
  ?linkset void:objectsTarget ?target ; void:linkPredicate ?predicate ; void:triples ?triples .
}`,
  },
  {
    title: "People born in the 1970s and their professions",
    description: "Numeric filters on xsd:integer years plus a property path.",
    query: `SELECT ?person ?name ?born (GROUP_CONCAT(DISTINCT ?profession; separator=", ") AS ?professions) WHERE {
  ?person a mo:Person ; rdfs:label ?name ; mo:birthYear ?born .
  FILTER(?born >= 1970 && ?born < 1980)
  OPTIONAL { ?person mo:primaryProfession/skos:prefLabel ?profession }
}
GROUP BY ?person ?name ?born
ORDER BY ?born
LIMIT 50`,
  },
];
```

- [ ] **Step 2: Write the styles, layout and shared components**

File: `web/src/app/globals.css`
```css
@import "tailwindcss";

@layer components {
  .card {
    @apply rounded-xl border border-slate-200 p-4 dark:border-slate-800;
  }
  .link {
    @apply text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400;
  }
  .btn {
    @apply inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:border-indigo-500 hover:text-indigo-600 dark:border-slate-700 dark:hover:text-indigo-400;
  }
  .btn-primary {
    @apply inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500;
  }
  .input {
    @apply rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900;
  }
}
```

File: `web/src/app/layout.tsx`
```tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://lod-movie.felix-nguyen.io.vn"),
  title: { default: "LOD Movie", template: "%s · LOD Movie" },
  description: "Linked Open Data about 300 IMDb movies, linked to Wikidata and DBpedia, with a public SPARQL endpoint.",
};

const NAV = [
  ["/movies", "Movies"],
  ["/people", "People"],
  ["/sparql", "SPARQL"],
  ["/explore", "Explore"],
  ["/ontology", "Ontology"],
  ["/dataset", "Dataset"],
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <header className="border-b border-slate-200 dark:border-slate-800">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              LOD<span className="text-indigo-600 dark:text-indigo-400">Movie</span>
            </Link>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400">
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 text-sm text-slate-500 dark:border-slate-800">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-4 py-6">
            <p>
              Data from the{" "}
              <a className="link" href="https://developer.imdb.com/non-commercial-datasets/">IMDb non-commercial datasets</a>, linked to
              Wikidata and DBpedia. A semantic web capstone project.
            </p>
            <p className="flex gap-4">
              <Link className="link" href="/dataset">About the dataset</Link>
              <Link className="link" href="/sparql">SPARQL endpoint</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
```

File: `web/src/components/ui.tsx`
```tsx
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-8 space-y-2">
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">{eyebrow}</p>}
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {children && <div className="max-w-3xl space-y-2 text-slate-600 dark:text-slate-300">{children}</div>}
    </header>
  );
}

export function Section({ title, id, action, children }: { title: string; id?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const body = (
    <>
      <div className="text-2xl font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString("en-US") : value}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className="card block hover:border-indigo-400">{body}</Link>
  ) : (
    <div className="card">{body}</div>
  );
}

export function Chip({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900">
      {children}
    </Link>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="card">
          <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="link break-all">
      {children}
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-slate-500">{children}</p>;
}
```

File: `web/src/components/term.tsx`
```tsx
import Link from "next/link";
import { pageHref, shorten, type Term } from "@/lib/rdf";

/** Render an RDF term: internal IRIs link to their page, external ones open in a new tab. */
export function TermValue({ term }: { term: Term }) {
  if (term.type === "uri") return <IriLink iri={term.value} />;
  if (term.type === "bnode") return <span className="text-slate-500">_:{term.value}</span>;
  const note = term.lang ? `@${term.lang}` : term.datatype && !term.datatype.endsWith("#string") ? shorten(term.datatype) : "";
  return (
    <span className="break-words">
      {term.value}
      {note && <sup className="ml-1 text-xs text-slate-500">{note}</sup>}
    </span>
  );
}

export function IriLink({ iri, label }: { iri: string; label?: string }) {
  const href = pageHref(iri);
  const text = label ?? shorten(iri);
  return href ? (
    <Link className="link break-all" href={href}>{text}</Link>
  ) : (
    <a className="link break-all" href={iri} target="_blank" rel="noreferrer">{text}</a>
  );
}
```

File: `web/src/components/copy-button.tsx`
```tsx
"use client";

import { useState } from "react";

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button type="button" className="btn" onClick={copy}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
```

File: `web/src/components/movie-card.tsx`
```tsx
import Link from "next/link";
import type { MovieCard as Movie } from "@/lib/queries";
import { pageHref } from "@/lib/rdf";

export default function MovieCard({ movie }: { movie: Movie }) {
  const meta = [movie.year, movie.rating !== undefined ? `★ ${movie.rating.toFixed(1)}` : null].filter(Boolean).join(" · ");
  return (
    <Link href={pageHref(movie.iri) ?? "#"} className="card block space-y-1 hover:border-indigo-400">
      <div className="font-semibold leading-snug">{movie.title}</div>
      {movie.vi && <div className="text-sm text-slate-600 dark:text-slate-300">{movie.vi}</div>}
      {meta && <div className="text-sm text-slate-500">{meta}</div>}
      {movie.genres && <div className="text-xs text-slate-500">{movie.genres}</div>}
    </Link>
  );
}
```

- [ ] **Step 3: Write home, search and not-found pages**

File: `web/src/app/page.tsx`
```tsx
import Link from "next/link";
import { Stat } from "@/components/ui";
import { EXAMPLES } from "@/lib/examples";
import { datasetStats } from "@/lib/queries";
import { sparqlHref } from "@/lib/rdf";

const FEATURES = [
  ["/movies", "Browse movies", "Filter by genre, year and rating; every list is a SPARQL query you can open."],
  ["/people", "Browse people", "Actors, directors, writers and crew with their filmographies."],
  ["/sparql", "SPARQL endpoint", "A public SPARQL 1.1 endpoint with an editor and example queries."],
  ["/explore", "Explore the graph", "Start from a movie and expand the triples around it, node by node."],
  ["/ontology", "Ontology", "Classes and properties of the LOD Movie vocabulary, as a diagram."],
  ["/dataset", "Dataset & 5★", "VoID description, statistics, downloads and the 5-star checklist."],
] as const;

export default function Home() {
  const s = datasetStats();
  const links = s.linksets.reduce((sum, l) => sum + l.triples, 0);
  const example = EXAMPLES[0];
  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Movies as Linked Open Data</h1>
        <p className="max-w-3xl text-lg text-slate-600 dark:text-slate-300">
          {s.movies} IMDb movies (1980–2025) with their cast, crew, genres and credits — published as 5★ Linked Data with English and
          Vietnamese titles, linked to Wikidata and DBpedia, and queryable through a public SPARQL endpoint.
        </p>
        <form action="/search" className="flex max-w-xl gap-2">
          <input name="q" required placeholder="Search movies and people…" className="input flex-1" />
          <button className="btn-primary">Search</button>
        </form>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Movies" value={s.classes.Movie ?? 0} href="/movies" />
        <Stat label="People" value={s.classes.Person ?? 0} href="/people" />
        <Stat label="Credits" value={s.classes.Credit ?? 0} />
        <Stat label="Triples" value={s.triples} href="/dataset" />
        <Stat label="External links" value={links} href="/dataset#linksets" />
        <Stat label="Movies on Wikidata" value={`${Math.round((100 * s.linkedMovies) / Math.max(1, s.movies))}%`} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([href, title, text]) => (
          <Link key={href} href={href} className="card block space-y-1 hover:border-indigo-400">
            <h2 className="font-semibold">{title}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">{text}</p>
          </Link>
        ))}
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Try a query: {example.title}</h2>
          <Link className="btn-primary" href={sparqlHref(example.query)}>Run it in the editor</Link>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-900">{example.query}</pre>
      </section>
    </div>
  );
}
```

File: `web/src/app/search/page.tsx`
```tsx
import Link from "next/link";
import MovieCard from "@/components/movie-card";
import { Empty, PageHeader, Section } from "@/components/ui";
import { listMovies, listPeople, parseMovieFilters, parsePeopleFilters, type SearchParams } from "@/lib/queries";
import { pageHref } from "@/lib/rdf";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const movieFilters = parseMovieFilters(sp);
  const q = movieFilters.q;
  const movies = q ? listMovies({ ...movieFilters, page: 1 }, 12) : null;
  const people = q ? listPeople({ ...parsePeopleFilters(sp), page: 1 }, 24) : null;
  const encoded = encodeURIComponent(q);
  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Search" title={q ? `Results for “${q}”` : "Search"}>
        <form action="/search" className="flex max-w-xl gap-2">
          <input name="q" defaultValue={q} required placeholder="Search movies and people…" className="input flex-1" />
          <button className="btn-primary">Search</button>
        </form>
      </PageHeader>
      {movies && (
        <Section title={`Movies (${movies.total})`} action={movies.total > 12 && <Link className="link" href={`/movies?q=${encoded}`}>All movie results →</Link>}>
          {movies.rows.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{movies.rows.map((m) => <MovieCard key={m.iri} movie={m} />)}</div>
          ) : (
            <Empty>No movies match.</Empty>
          )}
        </Section>
      )}
      {people && (
        <Section title={`People (${people.total})`} action={people.total > 24 && <Link className="link" href={`/people?q=${encoded}`}>All people results →</Link>}>
          {people.rows.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {people.rows.map((p) => (
                <li key={p.iri}>
                  <Link className="link" href={pageHref(p.iri)!}>{p.label}</Link>
                  <span className="text-sm text-slate-500"> · {p.movies} movie{p.movies === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No people match.</Empty>
          )}
        </Section>
      )}
    </div>
  );
}
```

File: `web/src/app/not-found.tsx`
```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4 py-16 text-center">
      <h1 className="text-3xl font-bold">Not found</h1>
      <p className="text-slate-600 dark:text-slate-300">This resource is not part of the LOD Movie dataset.</p>
      <p>
        <Link className="link" href="/">Home</Link> · <Link className="link" href="/search">Search</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Build, start and check**

Run the build and start commands, then:
```bash
B=http://localhost:3100
curl -s $B/ | grep -o "Movies as Linked Open Data\|>300<\|Movies on Wikidata" | sort -u
curl -s "$B/search?q=jurassic" | grep -o "Jurassic Park\|Công viên kỷ Jura" | sort -u
curl -s -o /dev/null -w "%{http_code}\n" "$B/search?q=%22" "$B/search?q=%5C" "$B/search?q=O%27Brien"
curl -s -o /dev/null -w "%{http_code}\n" $B/nope
```
Expected: the three home strings; both Jurassic Park titles; three `200`; `404`. Stop the server.

- [ ] **Step 5: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): layout, shared UI, home and search"
```

---

### Task 5: Browse pages

**Files:**
- Create: `web/src/components/pagination.tsx`, `web/src/app/movies/page.tsx`, `web/src/app/people/page.tsx`

**Interfaces:**
- Consumes: `queries.parseMovieFilters`, `listMovies`, `genreOptions`, `parsePeopleFilters`, `listPeople`, `professionOptions`, `MOVIES_PER_PAGE`, `PEOPLE_PER_PAGE`; `rdf.sparqlHref`, `pageHref`; `MovieCard`, `PageHeader`, `Empty`.
- Produces: `Pagination({page,total,perPage,basePath,params})` (default export).

- [ ] **Step 1: Write the pagination component and the two pages**

File: `web/src/components/pagination.tsx`
```tsx
import Link from "next/link";

type Props = { page: number; total: number; perPage: number; basePath: string; params: Record<string, string> };

export default function Pagination({ page, total, perPage, basePath, params }: Props) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const href = (target: number) => {
    const query = new URLSearchParams({ ...params, page: String(target) });
    for (const [key, value] of [...query]) if (!value) query.delete(key);
    return `${basePath}?${query}`;
  };
  return (
    <nav className="flex flex-wrap items-center justify-between gap-4 text-sm">
      <span className="text-slate-500">
        Page {page} of {pages} · {total.toLocaleString("en-US")} results
      </span>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn" href={href(page - 1)}>← Previous</Link>}
        {page < pages && <Link className="btn" href={href(page + 1)}>Next →</Link>}
      </div>
    </nav>
  );
}
```

File: `web/src/app/movies/page.tsx`
```tsx
import Link from "next/link";
import MovieCard from "@/components/movie-card";
import Pagination from "@/components/pagination";
import { Empty, PageHeader } from "@/components/ui";
import { genreOptions, listMovies, MOVIES_PER_PAGE, parseMovieFilters, type SearchParams } from "@/lib/queries";
import { sparqlHref } from "@/lib/rdf";

export const metadata = { title: "Movies" };

export default async function MoviesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseMovieFilters(await searchParams);
  const { rows, total, query } = listMovies(f);
  const genres = genreOptions();
  const params = {
    q: f.q,
    genre: f.genre,
    from: f.from?.toString() ?? "",
    to: f.to?.toString() ?? "",
    rating: f.rating?.toString() ?? "",
    sort: f.sort,
  };
  return (
    <div>
      <PageHeader eyebrow="Browse" title="Movies">
        <p>
          {total} movies match. Every list on this site is a SPARQL query over the dataset —{" "}
          <Link className="link" href={sparqlHref(query)}>open this one in the editor</Link>.
        </p>
      </PageHeader>
      <form action="/movies" className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <input name="q" defaultValue={f.q} placeholder="Title (English, Vietnamese or original)" className="input lg:col-span-2" />
        <select name="genre" defaultValue={f.genre} className="input">
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g.slug} value={g.slug}>{g.label} ({g.count})</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input name="from" type="number" min={1900} max={2100} placeholder="From" defaultValue={f.from} className="input w-full" />
          <input name="to" type="number" min={1900} max={2100} placeholder="To" defaultValue={f.to} className="input w-full" />
        </div>
        <select name="rating" defaultValue={f.rating?.toString() ?? ""} className="input">
          <option value="">Any rating</option>
          {[5, 6, 7, 8].map((r) => (
            <option key={r} value={r}>★ {r}+</option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="sort" defaultValue={f.sort} className="input w-full">
            <option value="rating">Top rated</option>
            <option value="votes">Most votes</option>
            <option value="year">Newest</option>
            <option value="title">Title A–Z</option>
          </select>
          <button className="btn-primary">Apply</button>
        </div>
      </form>
      {rows.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((m) => <MovieCard key={m.iri} movie={m} />)}
        </div>
      ) : (
        <Empty>
          No movies match these filters. <Link className="link" href="/movies">Reset filters</Link>
        </Empty>
      )}
      <div className="mt-8">
        <Pagination page={f.page} total={total} perPage={MOVIES_PER_PAGE} basePath="/movies" params={params} />
      </div>
    </div>
  );
}
```

File: `web/src/app/people/page.tsx`
```tsx
import Link from "next/link";
import Pagination from "@/components/pagination";
import { Empty, PageHeader } from "@/components/ui";
import { listPeople, parsePeopleFilters, PEOPLE_PER_PAGE, professionOptions, type SearchParams } from "@/lib/queries";
import { pageHref, sparqlHref } from "@/lib/rdf";

export const metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parsePeopleFilters(await searchParams);
  const { rows, total, query } = listPeople(f);
  const professions = professionOptions();
  const params = { q: f.q, profession: f.profession, sort: f.sort };
  return (
    <div>
      <PageHeader eyebrow="Browse" title="People">
        <p>
          {total.toLocaleString("en-US")} people match —{" "}
          <Link className="link" href={sparqlHref(query)}>open this query in the editor</Link>.
        </p>
      </PageHeader>
      <form action="/people" className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input name="q" defaultValue={f.q} placeholder="Name" className="input lg:col-span-2" />
        <select name="profession" defaultValue={f.profession} className="input">
          <option value="">All professions</option>
          {professions.map((p) => (
            <option key={p.slug} value={p.slug}>{p.label} ({p.count})</option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="sort" defaultValue={f.sort} className="input w-full">
            <option value="movies">Most movies</option>
            <option value="name">Name A–Z</option>
          </select>
          <button className="btn-primary">Apply</button>
        </div>
      </form>
      {rows.length ? (
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((p) => (
            <li key={p.iri} className="truncate">
              <Link className="link" href={pageHref(p.iri)!}>{p.label}</Link>
              <span className="text-sm text-slate-500"> · {p.movies}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          No people match. <Link className="link" href="/people">Reset filters</Link>
        </Empty>
      )}
      <div className="mt-8">
        <Pagination page={f.page} total={total} perPage={PEOPLE_PER_PAGE} basePath="/people" params={params} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build, start and check filters**

Run the build and start commands, then:
```bash
B=http://localhost:3100
curl -s "$B/movies" | grep -o "[0-9]* movies match" | head -1
curl -s "$B/movies?genre=horror&from=2000&rating=6&sort=year" | grep -o "[0-9]* movies match" | head -1
curl -s "$B/movies?q=c%C3%B4ng%20vi%C3%AAn" | grep -o "Jurassic Park" | head -1
curl -s -o /dev/null -w "%{http_code}\n" "$B/movies?q=%22%5C" "$B/movies?genre=%3Cbad%3E" "$B/movies?page=-4&from=abc"
curl -s "$B/people?profession=director&sort=name" | grep -o "[0-9,]* people match" | head -1
curl -s "$B/movies?page=2" | grep -o "Page 2 of [0-9]*" | head -1
```
Expected: `300 movies match`; a smaller count for the horror filter; `Jurassic Park` (Vietnamese title search works); three `200`; a director count; `Page 2 of 13`. Stop the server.

- [ ] **Step 3: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): movie and people browse pages with SPARQL-backed filters"
```

---

### Task 6: Live Wikidata facts

**Files:**
- Create: `web/src/lib/wikidata.ts`, `web/src/app/api/wikidata/[qid]/route.ts`, `web/src/components/wikidata-panel.tsx`

**Interfaces:**
- Consumes: `config.WIKIDATA_ENDPOINT`, `config.USER_AGENT`.
- Produces: `WikidataFacts {qid, label?, description?, image?, wikipedia?, facts: {label, value}[]}`, `WikidataKind = "movie" | "person"`, `wikidataFacts(qid, kind)`; route `/api/wikidata/{qid}?kind=movie|person`; client component `WikidataPanel({qid, kind, subject})` (default export).

- [ ] **Step 1: Write the Wikidata client, route and panel**

File: `web/src/lib/wikidata.ts`
```ts
import { USER_AGENT, WIKIDATA_ENDPOINT } from "./config";

export type WikidataFacts = {
  qid: string;
  label?: string;
  description?: string;
  image?: string;
  wikipedia?: string;
  facts: { label: string; value: string }[];
};

type Binding = Record<string, { value: string } | undefined>;

const common = (qid: string) => `
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }`;

const QUERIES = {
  movie: (qid: string) => `SELECT (SAMPLE(?label) AS ?label) (SAMPLE(?desc) AS ?description) (SAMPLE(?article) AS ?wikipedia)
  (SAMPLE(?img) AS ?image) (GROUP_CONCAT(DISTINCT ?countryLabel; separator=", ") AS ?countries)
  (MIN(?date) AS ?released) (COUNT(DISTINCT ?award) AS ?awards) WHERE {${common(qid)}
  OPTIONAL { ?item wdt:P3383|wdt:P18 ?img }
  OPTIONAL { ?item wdt:P495 ?country . ?country rdfs:label ?countryLabel FILTER(LANG(?countryLabel) = "en") }
  OPTIONAL { ?item wdt:P577 ?date }
  OPTIONAL { ?item wdt:P166 ?award }
}`,
  person: (qid: string) => `SELECT (SAMPLE(?label) AS ?label) (SAMPLE(?desc) AS ?description) (SAMPLE(?article) AS ?wikipedia)
  (SAMPLE(?img) AS ?image) (MIN(?birth) AS ?born) (SAMPLE(?placeLabel) AS ?birthplace)
  (GROUP_CONCAT(DISTINCT ?citizenLabel; separator=", ") AS ?citizenship) WHERE {${common(qid)}
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item wdt:P569 ?birth }
  OPTIONAL { ?item wdt:P19 ?place . ?place rdfs:label ?placeLabel FILTER(LANG(?placeLabel) = "en") }
  OPTIONAL { ?item wdt:P27 ?citizen . ?citizen rdfs:label ?citizenLabel FILTER(LANG(?citizenLabel) = "en") }
}`,
};

export type WikidataKind = keyof typeof QUERIES;

const day = (value?: string) => value?.slice(0, 10);

/** A few facts about a Wikidata item, fetched live and cached for a day. */
export async function wikidataFacts(qid: string, kind: WikidataKind): Promise<WikidataFacts> {
  const response = await fetch(`${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(QUERIES[kind](qid))}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 86400 },
  });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  const row: Binding = (await response.json()).results.bindings[0] ?? {};
  const facts: WikidataFacts["facts"] = [];
  const add = (label: string, value?: string) => {
    if (value) facts.push({ label, value });
  };
  if (kind === "movie") {
    add("Country of origin", row.countries?.value);
    add("First release", day(row.released?.value));
    const awards = Number(row.awards?.value ?? 0);
    if (awards) add("Awards received", String(awards));
  } else {
    add("Born", day(row.born?.value));
    add("Place of birth", row.birthplace?.value);
    add("Citizenship", row.citizenship?.value);
  }
  const image = row.image?.value;
  return {
    qid,
    label: row.label?.value,
    description: row.description?.value,
    wikipedia: row.wikipedia?.value,
    image: image ? `${image.replace(/^http:/, "https:")}?width=360` : undefined,
    facts,
  };
}
```

File: `web/src/app/api/wikidata/[qid]/route.ts`
```ts
import { wikidataFacts, type WikidataKind } from "@/lib/wikidata";

export async function GET(req: Request, { params }: { params: Promise<{ qid: string }> }) {
  const { qid } = await params;
  const kind: WikidataKind = new URL(req.url).searchParams.get("kind") === "person" ? "person" : "movie";
  if (!/^Q\d+$/.test(qid)) return Response.json({ error: "Invalid Wikidata ID" }, { status: 400 });
  try {
    return Response.json(await wikidataFacts(qid, kind), {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch {
    return Response.json({ error: "Wikidata is not reachable right now." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
```

File: `web/src/components/wikidata-panel.tsx`
```tsx
"use client";

import { useEffect, useState } from "react";
import type { WikidataFacts } from "@/lib/wikidata";

type State = { status: "loading" } | { status: "ready"; data: WikidataFacts } | { status: "error" };

/** Follows owl:sameAs to Wikidata at view time; nothing shown here is stored in the dataset. */
export default function WikidataPanel({ qid, kind, subject }: { qid: string; kind: "movie" | "person"; subject: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    fetch(`/api/wikidata/${qid}?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: WikidataFacts) => alive && setState({ status: "ready", data }))
      .catch(() => alive && setState({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [qid, kind]);
  const local = subject.split("/").slice(-2).join(":");
  return (
    <aside className="card space-y-3">
      <div>
        <h2 className="font-semibold">Live from Wikidata</h2>
        <p className="text-xs text-slate-500">
          Followed at view time via <code>{local} owl:sameAs wd:{qid}</code>; not stored in this dataset.
        </p>
      </div>
      {state.status === "loading" && <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />}
      {state.status === "error" && <p className="text-sm text-slate-500">Wikidata is not reachable right now.</p>}
      {state.status === "ready" && (
        <>
          {state.data.image && <img src={state.data.image} alt={state.data.label ?? qid} loading="lazy" className="w-full rounded-lg" />}
          {state.data.description && <p className="text-sm">{state.data.description}</p>}
          {state.data.facts.length > 0 && (
            <dl className="space-y-1 text-sm">
              {state.data.facts.map((f) => (
                <div key={f.label} className="flex justify-between gap-4">
                  <dt className="text-slate-500">{f.label}</dt>
                  <dd className="text-right">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            <a className="link" href={`https://www.wikidata.org/wiki/${qid}`} target="_blank" rel="noreferrer">Wikidata {qid}</a>
            {state.data.wikipedia && (
              <a className="link" href={state.data.wikipedia} target="_blank" rel="noreferrer">Wikipedia</a>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Build, start and check**

Run the build and start commands, then:
```bash
B=http://localhost:3100
curl -s "$B/api/wikidata/Q167726?kind=movie"; echo
curl -s "$B/api/wikidata/Q8877?kind=person"; echo
curl -s -w " %{http_code}\n" "$B/api/wikidata/abc"
```
Expected: Jurassic Park facts (country "United States", a 1993 release date, an image URL); Steven Spielberg facts (born 1946-12-18); `{"error":"Invalid Wikidata ID"} 400`. Stop the server.

- [ ] **Step 3: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): live Wikidata facts via owl:sameAs"
```

---

### Task 7: Resource pages

**Files:**
- Create: `web/src/lib/resource.ts`, `web/src/components/views.tsx`, `web/src/app/page/[type]/[id]/page.tsx`

**Interfaces:**
- Consumes: `store.select`, `rdf.*`, `queries.Named`, `queries.MovieCard`, `queries.toCard`, `linked-data.exists`, `WikidataPanel`, `CopyButton`, `MovieCard`, `ui.*`, `term.*`.
- Produces: `CreditRow`, `MovieView`, `FilmRow`, `PersonView`, `ConceptView`, `CreditView`, `TripleView`; `labelOf(iri)`, `sameAs(iri)`, `wikidataQid(links)`, `movieIds()`, `movieView(iri)`, `personView(iri)`, `conceptView(iri, kind)`, `creditView(iri)`, `genericView(iri)`; components `MovieDetail`, `PersonDetail`, `ConceptDetail`, `CreditDetail`, `GenericDetail`.

- [ ] **Step 1: Write the page data layer**

File: `web/src/lib/resource.ts`
```ts
import { toCard, type MovieCard, type Named } from "./queries";
import { asNumber, asString, iriRef, localName, type Term } from "./rdf";
import { select } from "./store";

export type CreditRow = { iri: string; order: number; person: Named; role: string; job?: string; characters?: string };
export type MovieView = {
  iri: string;
  imdbId: string;
  primaryTitle: string;
  originalTitle?: string;
  en?: string;
  vi?: string;
  year?: number;
  runtime?: number;
  rating?: number;
  votes?: number;
  genres: Named[];
  directors: Named[];
  writers: Named[];
  cast: CreditRow[];
  crew: CreditRow[];
  sameAs: string[];
};
export type FilmRow = { movie: Named; year?: number; roles: string[] };
export type PersonView = {
  iri: string;
  imdbId: string;
  name: string;
  birthYear?: number;
  deathYear?: number;
  professions: Named[];
  films: FilmRow[];
  knownFor: Named[];
  sameAs: string[];
};
export type ConceptView = {
  iri: string;
  kind: "genre" | "profession";
  label: string;
  isTarget?: boolean;
  matches: { iri: string; exact: boolean }[];
  movies: MovieCard[];
  people: Named[];
  peopleTotal: number;
};
export type CreditView = { iri: string; movie: Named; person: Named; role: string; order: number; job?: string; characters: string[] };
export type TripleView = { outgoing: { p: Term; o: Term }[]; incoming: { s: Term; p: Term }[] };

const CAST_ROLES = new Set(["actor", "actress", "self", "archive footage"]);

function named(query: string): Named[] {
  return select(query).map((r) => ({ iri: r.iri!.value, label: r.label!.value }));
}

export function labelOf(iri: string): string | undefined {
  const rows = select(`SELECT ?label WHERE { ${iriRef(iri)} rdfs:label|skos:prefLabel ?label } ORDER BY DESC(LANG(?label) = "en")`);
  return rows[0]?.label?.value;
}

export function sameAs(iri: string): string[] {
  return select(`SELECT ?x WHERE { ${iriRef(iri)} owl:sameAs ?x } ORDER BY ?x`).map((r) => r.x!.value);
}

export function wikidataQid(links: string[]): string | undefined {
  const wd = links.find((l) => l.startsWith("http://www.wikidata.org/entity/Q"));
  return wd ? localName(wd) : undefined;
}

export function movieIds(): string[] {
  return select(`SELECT ?m WHERE { ?m a mo:Movie }`).map((r) => localName(r.m!.value));
}

export function movieView(iri: string): MovieView | null {
  const r = iriRef(iri);
  const core = select(`SELECT * WHERE {
    ${r} a mo:Movie ; mo:imdbId ?imdb ; mo:primaryTitle ?pt .
    OPTIONAL { ${r} mo:originalTitle ?ot }
    OPTIONAL { ${r} rdfs:label ?en FILTER(LANG(?en) = "en") }
    OPTIONAL { ${r} rdfs:label ?vi FILTER(LANG(?vi) = "vi") }
    OPTIONAL { ${r} mo:releaseYear ?year }
    OPTIONAL { ${r} mo:runtimeMinutes ?runtime }
    OPTIONAL { ${r} mo:averageRating ?rating }
    OPTIONAL { ${r} mo:numVotes ?votes }
  }`)[0];
  if (!core) return null;
  const credits: CreditRow[] = select(`SELECT ?c ?order ?p ?name ?role ?job (GROUP_CONCAT(?ch; separator=" / ") AS ?chars) WHERE {
    ${r} mo:hasCredit ?c .
    ?c mo:billingOrder ?order ; mo:creditedPerson ?p ; mo:creditRole/skos:prefLabel ?role .
    ?p rdfs:label ?name .
    OPTIONAL { ?c mo:job ?job }
    OPTIONAL { ?c mo:characterName ?ch }
  } GROUP BY ?c ?order ?p ?name ?role ?job ORDER BY ?order`).map((row) => ({
    iri: row.c!.value,
    order: Number(row.order!.value),
    person: { iri: row.p!.value, label: row.name!.value },
    role: row.role!.value,
    job: asString(row.job),
    characters: asString(row.chars),
  }));
  return {
    iri,
    imdbId: core.imdb!.value,
    primaryTitle: core.pt!.value,
    originalTitle: asString(core.ot),
    en: asString(core.en),
    vi: asString(core.vi),
    year: asNumber(core.year),
    runtime: asNumber(core.runtime),
    rating: asNumber(core.rating),
    votes: asNumber(core.votes),
    genres: named(`SELECT ?iri ?label WHERE { ${r} mo:hasGenre ?iri . ?iri skos:prefLabel ?label } ORDER BY ?label`),
    directors: named(`SELECT ?iri ?label WHERE { ${r} mo:directedBy ?iri . ?iri rdfs:label ?label } ORDER BY ?label`),
    writers: named(`SELECT ?iri ?label WHERE { ${r} mo:writtenBy ?iri . ?iri rdfs:label ?label } ORDER BY ?label`),
    cast: credits.filter((c) => CAST_ROLES.has(c.role)),
    crew: credits.filter((c) => !CAST_ROLES.has(c.role)),
    sameAs: sameAs(iri),
  };
}

export function personView(iri: string): PersonView | null {
  const r = iriRef(iri);
  const core = select(`SELECT ?name ?imdb ?birth ?death WHERE {
    ${r} a mo:Person ; rdfs:label ?name ; mo:imdbId ?imdb .
    OPTIONAL { ${r} mo:birthYear ?birth }
    OPTIONAL { ${r} mo:deathYear ?death }
  }`)[0];
  if (!core) return null;
  const films = new Map<string, FilmRow>();
  for (const row of select(`SELECT DISTINCT ?iri ?label ?year ?role WHERE {
      { ?iri mo:hasCredit ?c . ?c mo:creditedPerson ${r} ; mo:creditRole/skos:prefLabel ?role }
      UNION { VALUES (?prop ?role) { (mo:directedBy "director") (mo:writtenBy "writer") (mo:hasActor "actor") } ?iri ?prop ${r} }
      ?iri mo:primaryTitle ?pt .
      OPTIONAL { ?iri mo:releaseYear ?year }
      OPTIONAL { ?iri rdfs:label ?en FILTER(LANG(?en) = "en") }
      BIND(COALESCE(?en, ?pt) AS ?label)
    } ORDER BY DESC(?year) ?label`)) {
    const key = row.iri!.value;
    const film = films.get(key) ?? { movie: { iri: key, label: row.label!.value }, year: asNumber(row.year), roles: [] };
    if (!film.roles.includes(row.role!.value)) film.roles.push(row.role!.value);
    films.set(key, film);
  }
  return {
    iri,
    imdbId: core.imdb!.value,
    name: core.name!.value,
    birthYear: asNumber(core.birth),
    deathYear: asNumber(core.death),
    professions: named(`SELECT ?iri ?label WHERE { ${r} mo:primaryProfession ?iri . ?iri skos:prefLabel ?label }`),
    films: [...films.values()],
    knownFor: named(`SELECT ?iri ?label WHERE { ${r} mo:knownFor ?iri . ?iri mo:primaryTitle ?pt . OPTIONAL { ?iri rdfs:label ?en FILTER(LANG(?en) = "en") } BIND(COALESCE(?en, ?pt) AS ?label) }`),
    sameAs: sameAs(iri),
  };
}

export function conceptView(iri: string, kind: "genre" | "profession"): ConceptView | null {
  const r = iriRef(iri);
  const core = select(`SELECT ?label ?target WHERE { ${r} skos:prefLabel ?label . OPTIONAL { ${r} mo:isTargetGenre ?target } }`)[0];
  if (!core) return null;
  const matches = select(`SELECT ?m ?rel WHERE { ${r} ?rel ?m FILTER(?rel IN (skos:exactMatch, skos:closeMatch)) } ORDER BY ?m`).map((x) => ({
    iri: x.m!.value,
    exact: x.rel!.value.endsWith("exactMatch"),
  }));
  const movies =
    kind === "genre"
      ? select(`SELECT ?iri ?title ?vi ?year ?rating WHERE {
          ?iri mo:hasGenre ${r} ; mo:primaryTitle ?pt .
          OPTIONAL { ?iri rdfs:label ?en FILTER(LANG(?en) = "en") }
          OPTIONAL { ?iri rdfs:label ?vi FILTER(LANG(?vi) = "vi") }
          OPTIONAL { ?iri mo:releaseYear ?year }
          OPTIONAL { ?iri mo:averageRating ?rating }
          BIND(COALESCE(?en, ?pt) AS ?title)
        } ORDER BY DESC(?rating)`).map(toCard)
      : [];
  const people = kind === "profession" ? named(`SELECT ?iri ?label WHERE { ?iri mo:primaryProfession ${r} ; rdfs:label ?label } ORDER BY ?label LIMIT 300`) : [];
  const peopleTotal = kind === "profession" ? Number(select(`SELECT (COUNT(?p) AS ?n) WHERE { ?p mo:primaryProfession ${r} }`)[0]?.n?.value ?? 0) : 0;
  return { iri, kind, label: core.label!.value, isTarget: core.target ? core.target.value === "true" : undefined, matches, movies, people, peopleTotal };
}

export function creditView(iri: string): CreditView | null {
  const r = iriRef(iri);
  const core = select(`SELECT ?movie ?title ?person ?name ?role ?order ?job WHERE {
    ?movie mo:hasCredit ${r} ; mo:primaryTitle ?pt .
    OPTIONAL { ?movie rdfs:label ?en FILTER(LANG(?en) = "en") }
    BIND(COALESCE(?en, ?pt) AS ?title)
    ${r} mo:creditedPerson ?person ; mo:creditRole/skos:prefLabel ?role ; mo:billingOrder ?order .
    ?person rdfs:label ?name .
    OPTIONAL { ${r} mo:job ?job }
  }`)[0];
  if (!core) return null;
  return {
    iri,
    movie: { iri: core.movie!.value, label: core.title!.value },
    person: { iri: core.person!.value, label: core.name!.value },
    role: core.role!.value,
    order: Number(core.order!.value),
    job: asString(core.job),
    characters: select(`SELECT ?c WHERE { ${r} mo:characterName ?c }`).map((x) => x.c!.value),
  };
}

export function genericView(iri: string): TripleView {
  const r = iriRef(iri);
  return {
    outgoing: select(`SELECT ?p ?o WHERE { ${r} ?p ?o } ORDER BY ?p LIMIT 300`).map((x) => ({ p: x.p!, o: x.o! })),
    incoming: select(`SELECT ?s ?p WHERE { ?s ?p ${r} } ORDER BY ?p LIMIT 300`).map((x) => ({ s: x.s!, p: x.p! })),
  };
}
```

- [ ] **Step 2: Write the views and the page route**

File: `web/src/components/views.tsx`
```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import CopyButton from "./copy-button";
import MovieCard from "./movie-card";
import { IriLink, TermValue } from "./term";
import { Chip, Empty, ExternalLink, Facts, Section } from "./ui";
import WikidataPanel from "./wikidata-panel";
import type { Named } from "@/lib/queries";
import { pageHref, shorten, sparqlHref } from "@/lib/rdf";
import { wikidataQid, type ConceptView, type CreditRow, type CreditView, type MovieView, type PersonView, type TripleView } from "@/lib/resource";

type Common = { iri: string; type: string; id: string };

const FORMATS = [
  ["ttl", "Turtle"],
  ["jsonld", "JSON-LD"],
  ["nt", "N-Triples"],
  ["rdf", "RDF/XML"],
] as const;

function ResourceHeader({ iri, type, id, kind, title, children }: Common & { kind: string; title: string; children?: ReactNode }) {
  return (
    <header className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">{kind}</p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {children}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="break-all rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{iri}</code>
        <CopyButton text={iri} />
      </div>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(([ext, label]) => (
          <a key={ext} className="btn" href={`/data/${type}/${id}.${ext}`}>{label}</a>
        ))}
        <Link className="btn" href={`/explore?uri=${encodeURIComponent(iri)}`}>Explore graph</Link>
        <Link className="btn" href={sparqlHref(`DESCRIBE <${iri}>`)}>View as SPARQL</Link>
      </div>
    </header>
  );
}

function PeopleLinks({ people }: { people: Named[] }) {
  if (!people.length) return <span className="text-slate-500">—</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {people.map((p) => <IriLink key={p.iri} iri={p.iri} label={p.label} />)}
    </span>
  );
}

function LinkedData({ links, imdb }: { links: string[]; imdb: string }) {
  return (
    <div className="card space-y-2">
      <h2 className="font-semibold">Linked data</h2>
      <ul className="space-y-1 text-sm">
        {links.map((link) => (
          <li key={link}>
            <span className="text-slate-500">owl:sameAs </span>
            <ExternalLink href={link}>{shorten(link)}</ExternalLink>
          </li>
        ))}
        <li>
          <span className="text-slate-500">rdfs:seeAlso </span>
          <ExternalLink href={imdb}>IMDb</ExternalLink>
        </li>
      </ul>
      {!links.length && <p className="text-sm text-slate-500">No Wikidata item has this IMDb ID yet.</p>}
    </div>
  );
}

function CreditTable({ rows, cast }: { rows: CreditRow[]; cast?: boolean }) {
  if (!rows.length) return <Empty>None listed.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-4">#</th>
            <th className="py-2 pr-4">Person</th>
            <th className="py-2 pr-4">{cast ? "Character" : "Role"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((c) => (
            <tr key={c.iri}>
              <td className="py-2 pr-4 tabular-nums"><IriLink iri={c.iri} label={String(c.order)} /></td>
              <td className="py-2 pr-4"><IriLink iri={c.person.iri} label={c.person.label} /></td>
              <td className="py-2 pr-4">
                {cast ? c.characters || "—" : [c.role, c.job && c.job !== c.role ? c.job : null].filter(Boolean).join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MovieDetail({ m, ...common }: Common & { m: MovieView }) {
  const title = m.en ?? m.primaryTitle;
  const qid = wikidataQid(m.sameAs);
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind="Movie" title={title}>
        {m.vi && <p className="text-lg">Vietnamese title: <span className="font-medium">{m.vi}</span></p>}
        {m.originalTitle && m.originalTitle !== title && <p className="text-slate-600 dark:text-slate-300">Original title: {m.originalTitle}</p>}
      </ResourceHeader>
      <Facts
        items={[
          ["Year", m.year ?? "—"],
          ["Runtime", m.runtime ? `${m.runtime} min` : "—"],
          ["IMDb rating", m.rating !== undefined ? `★ ${m.rating.toFixed(1)}` : "—"],
          ["Votes", m.votes?.toLocaleString("en-US") ?? "—"],
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {m.genres.map((g) => <Chip key={g.iri} href={pageHref(g.iri)!}>{g.label}</Chip>)}
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <Section title="Directed and written by">
            <dl className="space-y-2">
              <div className="flex gap-3"><dt className="w-24 text-slate-500">Directors</dt><dd><PeopleLinks people={m.directors} /></dd></div>
              <div className="flex gap-3"><dt className="w-24 text-slate-500">Writers</dt><dd><PeopleLinks people={m.writers} /></dd></div>
            </dl>
          </Section>
          <Section title={`Cast (${m.cast.length})`}><CreditTable rows={m.cast} cast /></Section>
          <Section title={`Crew (${m.crew.length})`}><CreditTable rows={m.crew} /></Section>
        </div>
        <div className="space-y-6">
          {qid && <WikidataPanel qid={qid} kind="movie" subject={m.iri} />}
          <LinkedData links={m.sameAs} imdb={`https://www.imdb.com/title/${m.imdbId}/`} />
        </div>
      </div>
    </div>
  );
}

export function PersonDetail({ p, ...common }: Common & { p: PersonView }) {
  const qid = wikidataQid(p.sameAs);
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind="Person" title={p.name} />
      <Facts
        items={[
          ["Born", p.birthYear ?? "—"],
          ["Died", p.deathYear ?? "—"],
          ["Movies here", p.films.length],
          ["IMDb", <ExternalLink key="imdb" href={`https://www.imdb.com/name/${p.imdbId}/`}>{p.imdbId}</ExternalLink>],
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {p.professions.map((x) => <Chip key={x.iri} href={pageHref(x.iri)!}>{x.label}</Chip>)}
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <Section title="Filmography in this dataset">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="py-2 pr-4">Year</th><th className="py-2 pr-4">Movie</th><th className="py-2 pr-4">Roles</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {p.films.map((f) => (
                    <tr key={f.movie.iri}>
                      <td className="py-2 pr-4 tabular-nums text-slate-500">{f.year ?? "—"}</td>
                      <td className="py-2 pr-4"><IriLink iri={f.movie.iri} label={f.movie.label} /></td>
                      <td className="py-2 pr-4">{f.roles.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          {p.knownFor.length > 0 && (
            <Section title="Known for (in this dataset)">
              <div className="flex flex-wrap gap-2">{p.knownFor.map((k) => <Chip key={k.iri} href={pageHref(k.iri)!}>{k.label}</Chip>)}</div>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          {qid && <WikidataPanel qid={qid} kind="person" subject={p.iri} />}
          <LinkedData links={p.sameAs} imdb={`https://www.imdb.com/name/${p.imdbId}/`} />
        </div>
      </div>
    </div>
  );
}

export function ConceptDetail({ c, ...common }: Common & { c: ConceptView }) {
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind={c.kind === "genre" ? "Genre" : "Profession"} title={c.label}>
        {c.isTarget && <p className="text-slate-600 dark:text-slate-300">One of the six genres the dataset was sampled from.</p>}
      </ResourceHeader>
      <Section title="Matches in other datasets">
        {c.matches.length ? (
          <ul className="space-y-1 text-sm">
            {c.matches.map((m) => (
              <li key={m.iri}>
                <span className="text-slate-500">{m.exact ? "skos:exactMatch" : "skos:closeMatch"} </span>
                <ExternalLink href={m.iri}>{shorten(m.iri)}</ExternalLink>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Deliberately not mapped (too vague to match a Wikidata item).</Empty>
        )}
      </Section>
      {c.kind === "genre" && (
        <Section title={`Movies (${c.movies.length})`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{c.movies.map((m) => <MovieCard key={m.iri} movie={m} />)}</div>
        </Section>
      )}
      {c.kind === "profession" && (
        <Section title={`People (${c.peopleTotal.toLocaleString("en-US")})`}>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            {c.people.map((p) => <li key={p.iri} className="truncate"><IriLink iri={p.iri} label={p.label} /></li>)}
          </ul>
          {c.peopleTotal > c.people.length && <p className="text-sm text-slate-500">Showing the first {c.people.length}.</p>}
        </Section>
      )}
    </div>
  );
}

export function CreditDetail({ c, ...common }: Common & { c: CreditView }) {
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind="Credit" title={`${c.person.label} — ${c.role}`}>
        <p className="text-slate-600 dark:text-slate-300">
          A <IriLink iri="https://lod-movie.felix-nguyen.io.vn/ontology#Credit" label="mo:Credit" /> node links a movie, a person and a role.
        </p>
      </ResourceHeader>
      <Facts
        items={[
          ["Movie", <IriLink key="m" iri={c.movie.iri} label={c.movie.label} />],
          ["Person", <IriLink key="p" iri={c.person.iri} label={c.person.label} />],
          ["Role", c.role],
          ["Billing order", c.order],
        ]}
      />
      {(c.job || c.characters.length > 0) && (
        <Section title="Details">
          {c.job && <p>Job: {c.job}</p>}
          {c.characters.length > 0 && <p>Characters: {c.characters.join(", ")}</p>}
        </Section>
      )}
    </div>
  );
}

export function GenericDetail({ t, title, ...common }: Common & { t: TripleView; title: string }) {
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind="Resource" title={title} />
      <Section title="Outgoing triples">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {t.outgoing.map((x, i) => (
              <tr key={i}><td className="py-2 pr-4 align-top"><TermValue term={x.p} /></td><td className="py-2"><TermValue term={x.o} /></td></tr>
            ))}
          </tbody>
        </table>
      </Section>
      {t.incoming.length > 0 && (
        <Section title="Incoming triples">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {t.incoming.map((x, i) => (
                <tr key={i}><td className="py-2 pr-4"><TermValue term={x.s} /></td><td className="py-2"><TermValue term={x.p} /></td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
```

File: `web/src/app/page/[type]/[id]/page.tsx`
```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConceptDetail, CreditDetail, GenericDetail, MovieDetail, PersonDetail } from "@/components/views";
import { exists } from "@/lib/linked-data";
import { resourceIri } from "@/lib/rdf";
import { conceptView, creditView, genericView, labelOf, movieIds, movieView, personView } from "@/lib/resource";

type Props = { params: Promise<{ type: string; id: string }> };

/** The 300 movie pages are built ahead of time; everything else renders on first visit and is then cached. */
export function generateStaticParams() {
  return movieIds().map((id) => ({ type: "movie", id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type, id } = await params;
  const iri = resourceIri(type, id);
  if (!iri || !exists(iri)) return {};
  return {
    title: labelOf(iri) ?? id,
    alternates: {
      types: {
        "text/turtle": `/data/${type}/${id}.ttl`,
        "application/ld+json": `/data/${type}/${id}.jsonld`,
      },
    },
  };
}

export default async function ResourcePage({ params }: Props) {
  const { type, id } = await params;
  const iri = resourceIri(type, id);
  if (!iri || !exists(iri)) notFound();
  const common = { iri, type, id };
  if (type === "movie") {
    const m = movieView(iri);
    if (m) return <MovieDetail {...common} m={m} />;
  }
  if (type === "person") {
    const p = personView(iri);
    if (p) return <PersonDetail {...common} p={p} />;
  }
  if (type === "genre" || type === "profession") {
    const c = conceptView(iri, type);
    if (c) return <ConceptDetail {...common} c={c} />;
  }
  if (type === "credit") {
    const c = creditView(iri);
    if (c) return <CreditDetail {...common} c={c} />;
  }
  return <GenericDetail {...common} t={genericView(iri)} title={labelOf(iri) ?? id} />;
}
```

- [ ] **Step 3: Build, start and check**

Run the build and start commands (the build log should list `/page/[type]/[id]` with 300 pre-rendered paths), then:
```bash
B=http://localhost:3100
curl -s $B/page/movie/tt0107290 | grep -o "Công viên kỷ Jura\|Steven Spielberg\|Live from Wikidata\|wd:Q167726" | sort -u
curl -s $B/page/person/nm0000229 | grep -o "Steven Spielberg\|Filmography in this dataset" | sort -u
curl -s $B/page/genre/sci-fi | grep -o "skos:exactMatch\|wd:Q471839" | sort -u
curl -s $B/page/profession/director | grep -o "People ([0-9,]*)" | head -1
curl -s $B/page/credit/tt0107290-1 | grep -o "Billing order" | head -1
curl -s $B/page/scheme/genres | grep -o "Outgoing triples" | head -1
curl -s -o /dev/null -w "%{http_code}\n" $B/page/person/nm9999999 $B/page/foo/bar $B/page/movie/..%2F
curl -s $B/page/movie/tt0107290 | grep -o '<link rel="alternate" type="text/turtle"[^>]*>'
curl -s $B/data/person/nm0000229.jsonld | head -c 300; echo
```
Expected: all four Jurassic Park strings; Spielberg page strings; SKOS match strings; a people count; `Billing order`; `Outgoing triples`; three `404`; the alternate link tag; JSON-LD for Spielberg. Also open `http://localhost:3100/page/movie/tt0107290` in a browser and confirm the Wikidata panel loads with a poster. Stop the server.

- [ ] **Step 4: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): movie, person, concept, credit and generic resource pages"
```

---

### Task 8: SPARQL editor page

**Files:**
- Create: `web/src/components/sparql-editor.tsx`, `web/src/app/sparql/page.tsx`

**Interfaces:**
- Consumes: `EXAMPLES`, `withPrefixes`, `config.BASE`, `config.RESULT_LIMIT`, `GRAPH`, `PageHeader`; `/public/vendor/yasgui/*` from Task 1.
- Produces: client component `SparqlEditor({examples})` (default export).

- [ ] **Step 1: Write the editor component and the page**

File: `web/src/components/sparql-editor.tsx`
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Example } from "@/lib/examples";

type YasguiTab = { setQuery(query: string): unknown; query(): Promise<unknown> };
type YasguiInstance = { getTab(): YasguiTab | undefined };
type YasguiConstructor = new (element: HTMLElement, config: object) => YasguiInstance;

declare global {
  interface Window {
    Yasgui?: YasguiConstructor;
  }
}

let loading: Promise<YasguiConstructor> | null = null;

/** YASGUI is loaded as its prebuilt browser bundle (copied to /vendor by prepare-data). */
function loadYasgui(): Promise<YasguiConstructor> {
  if (window.Yasgui) return Promise.resolve(window.Yasgui);
  loading ??= new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/vendor/yasgui/yasgui.min.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "/vendor/yasgui/yasgui.min.js";
    script.onload = () => (window.Yasgui ? resolve(window.Yasgui) : reject(new Error("Yasgui missing")));
    script.onerror = () => reject(new Error("Yasgui failed to load"));
    document.body.appendChild(script);
  });
  return loading;
}

export default function SparqlEditor({ examples }: { examples: Example[] }) {
  const host = useRef<HTMLDivElement>(null);
  const yasgui = useRef<YasguiInstance | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadYasgui()
      .then((Yasgui) => {
        if (cancelled || !host.current || yasgui.current) return;
        const initial = new URLSearchParams(window.location.search).get("q") ?? examples[0]?.query ?? "";
        yasgui.current = new Yasgui(host.current, {
          requestConfig: { endpoint: `${window.location.origin}/sparql`, method: "POST" },
          copyEndpointOnNewTab: false,
          persistenceId: null,
          populateFromUrl: false,
        });
        yasgui.current.getTab()?.setQuery(initial);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [examples]);

  function run(query: string) {
    const tab = yasgui.current?.getTab();
    if (!tab) return;
    tab.setQuery(query);
    tab.query();
    host.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
      <aside className="space-y-3">
        <h2 className="font-semibold">Example queries</h2>
        <ul className="space-y-3">
          {examples.map((example) => (
            <li key={example.title}>
              <button type="button" onClick={() => run(example.query)} className="link text-left text-sm font-medium">
                {example.title}
              </button>
              <p className="text-xs text-slate-500">{example.description}</p>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 rounded-xl bg-white p-2 text-slate-900">
        {failed && <p className="p-4 text-sm">The query editor could not be loaded. The endpoint still works — see the curl example below.</p>}
        <div ref={host} />
      </div>
    </div>
  );
}
```

File: `web/src/app/sparql/page.tsx`
```tsx
import SparqlEditor from "@/components/sparql-editor";
import { PageHeader } from "@/components/ui";
import { BASE, GRAPH, RESULT_LIMIT } from "@/lib/config";
import { EXAMPLES } from "@/lib/examples";
import { withPrefixes } from "@/lib/rdf";

export const metadata = { title: "SPARQL endpoint" };

export default function SparqlPage() {
  const endpoint = `${BASE}sparql`;
  const examples = EXAMPLES.map((example) => ({ ...example, query: withPrefixes(example.query) }));
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Query" title="SPARQL endpoint">
        <p>
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{endpoint}</code> is a public, read-only SPARQL 1.1 endpoint (GET or POST).
          SELECT/ASK results come as JSON, XML, CSV or TSV; CONSTRUCT/DESCRIBE as Turtle, JSON-LD, N-Triples or RDF/XML — chosen by the
          <code> Accept</code> header or a <code>format</code> parameter.
        </p>
        <p className="text-sm">
          Results are capped at {RESULT_LIMIT.toLocaleString("en-US")} rows and queries stop after 10 seconds. Named graphs:{" "}
          {Object.values(GRAPH).map((g) => <code key={g} className="mr-2">&lt;{g}&gt;</code>)}
        </p>
      </PageHeader>
      <SparqlEditor examples={examples} />
      <section className="card space-y-2">
        <h2 className="font-semibold">From the command line</h2>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-900">{`curl -H "Accept: text/csv" \\
  --data-urlencode "query=SELECT ?movie ?title WHERE { ?movie a <https://lod-movie.felix-nguyen.io.vn/ontology#Movie> ; <http://www.w3.org/2000/01/rdf-schema#label> ?title } LIMIT 5" \\
  ${endpoint}`}</pre>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Build, start and check**

Run the build and start commands, then:
```bash
B=http://localhost:3100
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" -H "Accept: text/html" $B/sparql
curl -s -X POST -H "Content-Type: application/x-www-form-urlencoded" -H "Accept: application/sparql-results+json" --data-urlencode "query=SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }" $B/sparql; echo
curl -s -o /dev/null -w "%{http_code}\n" $B/vendor/yasgui/yasgui.min.js
```
Expected: `200 text/html…`; a JSON count of about 104,482 (proves the proxy forwards POST bodies); `200`. In a browser open `http://localhost:3100/sparql`: the editor shows example 1; clicking "Cast of Jurassic Park with characters" runs it and shows a table; the "Open this one in the editor" link from `/movies` opens that query. Stop the server.

- [ ] **Step 3: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): YASGUI SPARQL editor page with example queries"
```

---

### Task 9: Ontology documentation and diagram

**Files:**
- Create: `web/src/lib/ontology.ts`, `web/src/components/ontology-graph.tsx`, `web/src/app/ontology/page.tsx`

**Interfaces:**
- Consumes: `select`, `iriRef`, `localName`, `shorten`, `GRAPH`, `MO`, `ONTOLOGY`.
- Produces: `OntologyTerm`, `ontologyTerms()`, `ontologyHeader()`, `ontologyDiagram(terms) → {nodes: DiagramNode[], edges: DiagramEdge[]}`; client component `OntologyGraph({nodes, edges})` (default export).

- [ ] **Step 1: Write the ontology model**

File: `web/src/lib/ontology.ts`
```ts
import { GRAPH, MO, ONTOLOGY } from "./config";
import { iriRef, localName, shorten } from "./rdf";
import { select } from "./store";

export type TermKind = "Class" | "ObjectProperty" | "DatatypeProperty";
export type OntologyTerm = {
  iri: string;
  name: string;
  kind: TermKind;
  label: string;
  comment?: string;
  functional: boolean;
  relations: Record<string, string[]>;
};
export type DiagramNode = { id: string; label: string; external: boolean; comment?: string; datatypeProps: string[] };
export type DiagramEdge = { id: string; source: string; target: string; label: string; kind: "object" | "subclass" | "equivalent" };

const G = iriRef(GRAPH.ontology);
const OWL = "http://www.w3.org/2002/07/owl#";
export const RELATION_LABELS: Record<string, string> = {
  "rdfs:domain": "Domain",
  "rdfs:range": "Range",
  "rdfs:subClassOf": "Subclass of",
  "rdfs:subPropertyOf": "Subproperty of",
  "owl:equivalentClass": "Equivalent class",
  "owl:inverseOf": "Inverse of",
};

export function ontologyHeader() {
  const rows = select(`SELECT ?p ?o WHERE { GRAPH ${G} { ${iriRef(ONTOLOGY)} ?p ?o } }`);
  const one = (local: string) => rows.find((r) => r.p!.value.endsWith(local))?.o?.value;
  return { title: one("/title"), description: one("/description"), creator: one("/creator"), created: one("/created"), version: one("#versionInfo") };
}

export function ontologyTerms(): OntologyTerm[] {
  const base = select(`SELECT ?term ?kind ?label ?comment WHERE { GRAPH ${G} {
    ?term a ?kind ; rdfs:label ?label .
    OPTIONAL { ?term rdfs:comment ?comment }
    FILTER(?kind IN (owl:Class, owl:ObjectProperty, owl:DatatypeProperty))
    FILTER(STRSTARTS(STR(?term), STR(mo:)))
  } } ORDER BY ?label`);
  const relations = select(`SELECT ?term ?rel ?target WHERE { GRAPH ${G} {
    ?term ?rel ?value .
    FILTER(?rel IN (rdfs:domain, rdfs:range, rdfs:subClassOf, rdfs:subPropertyOf, owl:equivalentClass, owl:inverseOf))
    FILTER(STRSTARTS(STR(?term), STR(mo:)))
    OPTIONAL { ?value owl:unionOf/rdf:rest*/rdf:first ?member }
    BIND(COALESCE(?member, ?value) AS ?target)
    FILTER(isIRI(?target))
  } }`);
  const functional = new Set(select(`SELECT ?term WHERE { GRAPH ${G} { ?term a owl:FunctionalProperty } }`).map((r) => r.term!.value));
  return base.map((row) => {
    const iri = row.term!.value;
    const rels: Record<string, string[]> = {};
    for (const rel of relations.filter((r) => r.term!.value === iri)) {
      const key = shorten(rel.rel!.value);
      const list = (rels[key] ??= []);
      if (!list.includes(rel.target!.value)) list.push(rel.target!.value);
    }
    return {
      iri,
      name: iri.slice(MO.length),
      kind: row.kind!.value.slice(OWL.length) as TermKind,
      label: row.label!.value,
      comment: row.comment?.value,
      functional: functional.has(iri),
      relations: rels,
    };
  });
}

export function ontologyDiagram(terms: OntologyTerm[]): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const nodes = new Map<string, DiagramNode>();
  const addNode = (iri: string) => {
    if (!nodes.has(iri)) {
      const own = terms.find((t) => t.iri === iri);
      nodes.set(iri, { id: iri, label: own ? own.name : shorten(iri), external: !own, comment: own?.comment, datatypeProps: [] });
    }
    return nodes.get(iri)!;
  };
  const edges: DiagramEdge[] = [];
  for (const term of terms.filter((t) => t.kind === "Class")) {
    addNode(term.iri);
    for (const target of term.relations["rdfs:subClassOf"] ?? []) {
      addNode(target);
      edges.push({ id: `${term.iri}>sub>${target}`, source: term.iri, target, label: "subClassOf", kind: "subclass" });
    }
    for (const target of term.relations["owl:equivalentClass"] ?? []) {
      addNode(target);
      edges.push({ id: `${term.iri}>eq>${target}`, source: term.iri, target, label: "equivalentClass", kind: "equivalent" });
    }
  }
  for (const term of terms.filter((t) => t.kind === "ObjectProperty")) {
    for (const domain of term.relations["rdfs:domain"] ?? []) {
      for (const range of term.relations["rdfs:range"] ?? []) {
        addNode(domain);
        addNode(range);
        edges.push({ id: `${domain}>${term.name}>${range}`, source: domain, target: range, label: term.name, kind: "object" });
      }
    }
  }
  for (const term of terms.filter((t) => t.kind === "DatatypeProperty")) {
    const range = (term.relations["rdfs:range"] ?? []).map((r) => shorten(r)).join(", ");
    for (const domain of term.relations["rdfs:domain"] ?? []) addNode(domain).datatypeProps.push(`${term.name} → ${range || localName(term.iri)}`);
  }
  return { nodes: [...nodes.values()], edges };
}
```

- [ ] **Step 2: Write the diagram component and the page**

File: `web/src/components/ontology-graph.tsx`
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import type { DiagramEdge, DiagramNode } from "@/lib/ontology";

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      shape: "round-rectangle",
      width: (node: cytoscape.NodeSingular) => Math.max(70, String(node.data("label")).length * 7.5 + 24),
      height: 34,
      "background-color": "#4f46e5",
      color: "#ffffff",
      "font-size": 12,
      "text-valign": "center",
      "text-halign": "center",
    },
  },
  {
    selector: "node[?external]",
    style: { "background-color": "#f1f5f9", color: "#334155", "border-width": 1, "border-style": "dashed", "border-color": "#64748b" },
  },
  { selector: "node:selected", style: { "border-width": 3, "border-color": "#f59e0b", "border-style": "solid" } },
  {
    selector: "edge",
    style: {
      label: "data(label)",
      width: 1.5,
      "curve-style": "bezier",
      "line-color": "#94a3b8",
      "target-arrow-color": "#94a3b8",
      "target-arrow-shape": "triangle",
      "font-size": 10,
      color: "#334155",
      "text-rotation": "autorotate",
      "text-background-color": "#ffffff",
      "text-background-opacity": 1,
      "text-background-padding": "2px",
    },
  },
  { selector: 'edge[kind = "subclass"], edge[kind = "equivalent"]', style: { "line-style": "dashed", "target-arrow-shape": "triangle-backcurve" } },
];

const LAYOUT: cytoscape.CoseLayoutOptions = { name: "cose", animate: false, nodeDimensionsIncludeLabels: true, idealEdgeLength: () => 140, nodeRepulsion: () => 12000, padding: 30 };

export default function OntologyGraph({ nodes, edges }: { nodes: DiagramNode[]; edges: DiagramEdge[] }) {
  const host = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  const [selected, setSelected] = useState<DiagramNode | null>(null);

  useEffect(() => {
    let destroyed = false;
    import("cytoscape").then(({ default: cytoscapeFactory }) => {
      if (destroyed || !host.current) return;
      const instance = cytoscapeFactory({
        container: host.current,
        elements: [...nodes.map((data) => ({ data })), ...edges.map((data) => ({ data }))],
        style: STYLE,
        layout: LAYOUT,
        wheelSensitivity: 0.2,
      });
      instance.on("tap", "node", (event) => setSelected(nodes.find((n) => n.id === event.target.id()) ?? null));
      instance.on("tap", (event) => {
        if (event.target === instance) setSelected(null);
      });
      cy.current = instance;
    });
    return () => {
      destroyed = true;
      cy.current?.destroy();
      cy.current = null;
    };
  }, [nodes, edges]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="relative">
        <div ref={host} className="h-[560px] w-full rounded-xl border border-slate-200 bg-white dark:border-slate-800" />
        <button type="button" className="btn absolute right-3 top-3 bg-white text-slate-900" onClick={() => cy.current?.layout(LAYOUT).run()}>
          Reset layout
        </button>
      </div>
      <aside className="card space-y-2 text-sm">
        {selected ? (
          <>
            <h3 className="font-semibold">{selected.label}</h3>
            {selected.external ? (
              <p className="text-slate-500">External vocabulary term this ontology aligns to.</p>
            ) : (
              <>
                {selected.comment && <p>{selected.comment}</p>}
                <h4 className="pt-2 text-xs uppercase tracking-wide text-slate-500">Datatype properties</h4>
                {selected.datatypeProps.length ? (
                  <ul className="space-y-1 font-mono text-xs">{selected.datatypeProps.map((p) => <li key={p}>{p}</li>)}</ul>
                ) : (
                  <p className="text-slate-500">None.</p>
                )}
                <a className="link" href={`#${selected.label}`}>Documentation ↓</a>
              </>
            )}
          </>
        ) : (
          <p className="text-slate-500">
            Drag nodes to rearrange, scroll to zoom. Click a class to see its datatype properties. Solid arrows are object properties (domain →
            range); dashed arrows are alignments to schema.org, DBpedia, FOAF and SKOS.
          </p>
        )}
      </aside>
    </div>
  );
}
```

File: `web/src/app/ontology/page.tsx`
```tsx
import CopyButton from "@/components/copy-button";
import OntologyGraph from "@/components/ontology-graph";
import { IriLink } from "@/components/term";
import { PageHeader, Section } from "@/components/ui";
import { ONTOLOGY } from "@/lib/config";
import { ontologyDiagram, ontologyHeader, ontologyTerms, RELATION_LABELS, type OntologyTerm, type TermKind } from "@/lib/ontology";

export const metadata = { title: "Ontology" };

const GROUPS: [TermKind, string][] = [
  ["Class", "Classes"],
  ["ObjectProperty", "Object properties"],
  ["DatatypeProperty", "Datatype properties"],
];

function TermDoc({ term }: { term: OntologyTerm }) {
  return (
    <article id={term.name} className="card scroll-mt-20 space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="font-mono text-lg font-semibold">mo:{term.name}</h3>
        <span className="text-sm text-slate-500">{term.label}</span>
        {term.functional && <span className="rounded bg-amber-100 px-2 text-xs text-amber-800">functional</span>}
      </div>
      {term.comment && <p className="text-slate-600 dark:text-slate-300">{term.comment}</p>}
      {Object.keys(term.relations).length > 0 && (
        <dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
          {Object.entries(term.relations).map(([rel, targets]) => (
            <div key={rel} className="contents">
              <dt className="text-slate-500">{RELATION_LABELS[rel] ?? rel}</dt>
              <dd className="flex flex-wrap gap-x-3">{targets.map((t) => <IriLink key={t} iri={t} />)}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

export default function OntologyPage() {
  const header = ontologyHeader();
  const terms = ontologyTerms();
  const diagram = ontologyDiagram(terms);
  return (
    <div className="space-y-12">
      <PageHeader eyebrow={`Ontology · version ${header.version ?? "1.0.0"}`} title={header.title ?? "LOD Movie Ontology"}>
        <p>{header.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <code className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{ONTOLOGY}#</code>
          <CopyButton text={`${ONTOLOGY}#`} />
          <a className="btn" href="/downloads/ontology.ttl">Download Turtle</a>
        </div>
        <p className="text-sm">
          This URI dereferences: browsers get this page, RDF clients get the ontology (try <code>curl -H &quot;Accept: text/turtle&quot; {ONTOLOGY}</code>).
          Term URIs such as <code>{ONTOLOGY}#Movie</code> land on their section below.
        </p>
      </PageHeader>
      <Section title="Diagram">
        <OntologyGraph nodes={diagram.nodes} edges={diagram.edges} />
      </Section>
      {GROUPS.map(([kind, title]) => (
        <Section key={kind} title={title}>
          <div className="grid gap-4 lg:grid-cols-2">
            {terms.filter((t) => t.kind === kind).map((t) => <TermDoc key={t.iri} term={t} />)}
          </div>
        </Section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2b: Build, start and check**

Run the build and start commands, then:
```bash
B=http://localhost:3100
curl -s -H "Accept: text/html" $B/ontology | grep -o 'id="Movie"\|id="hasCredit"\|id="billingOrder"\|functional' | sort -u
curl -s -H "Accept: text/turtle" $B/ontology | head -3
```
Expected: the three anchors and `functional`; the first lines of `ontology.ttl`. In a browser open `/ontology`: the diagram shows Movie, Person, Credit, Genre, Profession plus dashed external nodes; nodes drag; clicking Movie lists its datatype properties; `/ontology#Credit` scrolls to the Credit section. Stop the server.

- [ ] **Step 3: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): ontology documentation page with interactive diagram"
```

---

### Task 10: Triple explorer

**Files:**
- Create: `web/src/lib/graph.ts`, `web/src/app/api/neighbors/route.ts`, `web/src/app/api/lookup/route.ts`, `web/src/components/explorer.tsx`, `web/src/app/explore/page.tsx`

**Interfaces:**
- Consumes: `select`, `iriRef`, `isSafeIri`, `lit`, `pageHref`, `shorten`, `localName`, `MO`, `RESOURCE`.
- Produces: `GraphNode {id,label,kind:"resource"|"external"|"literal",cls,href?}`, `GraphEdge {id,source,target,label}`, `neighbors(iri, max=50) → {nodes, edges}`, `lookup(q) → {iri,label,kind}[]`; routes `/api/neighbors?uri=`, `/api/lookup?q=`; client component `Explorer({start})` (default export).

- [ ] **Step 1: Write the graph library and API routes**

File: `web/src/lib/graph.ts`
```ts
import { MO, RESOURCE } from "./config";
import { iriRef, lit, localName, pageHref, shorten, type Row, type Term } from "./rdf";
import { select } from "./store";

export type GraphNode = { id: string; label: string; kind: "resource" | "external" | "literal"; cls: string; href?: string };
export type GraphEdge = { id: string; source: string; target: string; label: string };

const CLASSES = ["Movie", "Person", "Credit", "Genre", "Profession"];
const truncate = (text: string, n = 38) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

type Grouped = { term: Term; p: string; labels: Term[]; types: string[] };

function group(rows: Row[], key: "o" | "s"): Grouped[] {
  const map = new Map<string, Grouped>();
  for (const row of rows) {
    const term = row[key]!;
    const id = `${row.p!.value} ${term.type} ${term.value} ${term.lang ?? ""}`;
    const entry = map.get(id) ?? { term, p: row.p!.value, labels: [], types: [] };
    if (row.label) entry.labels.push(row.label);
    if (row.type && !entry.types.includes(row.type.value)) entry.types.push(row.type.value);
    map.set(id, entry);
  }
  return [...map.values()];
}

function bestLabel(labels: Term[]): string | undefined {
  return (labels.find((l) => l.lang === "en") ?? labels.find((l) => !l.lang) ?? labels[0])?.value;
}

function classOf(iri: string, types: string[]): string {
  if (iri.startsWith(MO)) return "Ontology";
  for (const type of types) if (type.startsWith(MO) && CLASSES.includes(type.slice(MO.length))) return type.slice(MO.length);
  return "Other";
}

function resourceNode(iri: string, labels: Term[], types: string[]): GraphNode {
  const internal = iri.startsWith(RESOURCE) || iri.startsWith(MO);
  const label = bestLabel(labels) ?? (iri.startsWith(RESOURCE) ? localName(iri) : shorten(iri));
  return { id: iri, label: truncate(label), kind: internal ? "resource" : "external", cls: classOf(iri, types), href: pageHref(iri) ?? iri };
}

/** A resource and up to `max` of its neighbours (outgoing first, then incoming). */
export function neighbors(iri: string, max = 50): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const r = iriRef(iri);
  const self = select(`SELECT ?label ?type WHERE { OPTIONAL { ${r} rdfs:label|skos:prefLabel ?label } OPTIONAL { ${r} a ?type } }`);
  const nodes = new Map<string, GraphNode>();
  nodes.set(iri, resourceNode(iri, self.flatMap((x) => (x.label ? [x.label] : [])), self.flatMap((x) => (x.type ? [x.type.value] : []))));
  const edges: GraphEdge[] = [];

  const out = group(
    select(`SELECT ?p ?o ?label ?type WHERE { ${r} ?p ?o . OPTIONAL { ?o rdfs:label|skos:prefLabel ?label } OPTIONAL { ?o a ?type } } LIMIT 400`),
    "o",
  ).slice(0, Math.ceil(max * 0.7));
  for (const n of out) {
    if (n.term.type === "literal") {
      const id = `literal:${iri}|${n.p}|${n.term.value}|${n.term.lang ?? ""}`;
      nodes.set(id, { id, label: truncate(n.term.value + (n.term.lang ? ` @${n.term.lang}` : "")), kind: "literal", cls: "Literal" });
      edges.push({ id: `${iri}|${n.p}|${id}`, source: iri, target: id, label: shorten(n.p) });
    } else if (n.term.type === "uri") {
      if (!nodes.has(n.term.value)) nodes.set(n.term.value, resourceNode(n.term.value, n.labels, n.types));
      edges.push({ id: `${iri}|${n.p}|${n.term.value}`, source: iri, target: n.term.value, label: shorten(n.p) });
    }
  }

  const incoming = group(
    select(`SELECT ?s ?p ?label ?type WHERE { ?s ?p ${r} . OPTIONAL { ?s rdfs:label|skos:prefLabel ?label } OPTIONAL { ?s a ?type } } LIMIT 400`),
    "s",
  ).slice(0, Math.max(0, max - out.length));
  for (const n of incoming) {
    if (n.term.type !== "uri") continue;
    if (!nodes.has(n.term.value)) nodes.set(n.term.value, resourceNode(n.term.value, n.labels, n.types));
    edges.push({ id: `${n.term.value}|${n.p}|${iri}`, source: n.term.value, target: iri, label: shorten(n.p) });
  }
  return { nodes: [...nodes.values()], edges };
}

export function lookup(q: string): { iri: string; label: string; kind: string }[] {
  const seen = new Set<string>();
  return select(`SELECT ?iri ?label ?type WHERE {
    VALUES ?type { mo:Movie mo:Person }
    ?iri a ?type ; rdfs:label ?label .
    FILTER(CONTAINS(LCASE(?label), ${lit(q.toLowerCase())}))
  } LIMIT 30`)
    .filter((r) => !seen.has(r.iri!.value) && seen.add(r.iri!.value))
    .slice(0, 10)
    .map((r) => ({ iri: r.iri!.value, label: r.label!.value, kind: localName(r.type!.value) }));
}
```

File: `web/src/app/api/neighbors/route.ts`
```ts
import { neighbors } from "@/lib/graph";
import { isSafeIri } from "@/lib/rdf";

export async function GET(req: Request) {
  const uri = new URL(req.url).searchParams.get("uri") ?? "";
  if (!isSafeIri(uri)) return Response.json({ error: "Invalid uri" }, { status: 400 });
  return Response.json(neighbors(uri));
}
```

File: `web/src/app/api/lookup/route.ts`
```ts
import { lookup } from "@/lib/graph";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  return Response.json(q.length < 2 ? [] : lookup(q));
}
```

- [ ] **Step 2: Write the explorer component and page**

File: `web/src/components/explorer.tsx`
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import type { GraphEdge, GraphNode } from "@/lib/graph";

const COLORS: Record<string, string> = {
  Movie: "#4f46e5",
  Person: "#059669",
  Credit: "#d97706",
  Genre: "#db2777",
  Profession: "#0284c7",
  Ontology: "#7c3aed",
  Other: "#475569",
};

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "background-color": (node: cytoscape.NodeSingular) => COLORS[node.data("cls")] ?? COLORS.Other,
      width: 26,
      height: 26,
      "font-size": 10,
      color: "#1e293b",
      "text-valign": "bottom",
      "text-margin-y": 4,
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.85,
      "text-background-padding": "1px",
    },
  },
  { selector: 'node[kind = "external"]', style: { "background-color": "#ffffff", "border-width": 2, "border-color": "#64748b", "border-style": "dashed" } },
  { selector: 'node[kind = "literal"]', style: { shape: "round-rectangle", "background-color": "#e2e8f0", width: 14, height: 14, color: "#475569" } },
  { selector: "node.expanded", style: { "border-width": 3, "border-color": "#0f172a" } },
  {
    selector: "edge",
    style: {
      label: "data(label)",
      width: 1,
      "curve-style": "bezier",
      "line-color": "#cbd5e1",
      "target-arrow-color": "#cbd5e1",
      "target-arrow-shape": "triangle",
      "font-size": 8,
      color: "#64748b",
      "text-rotation": "autorotate",
    },
  },
];

type Found = { iri: string; label: string; kind: string };

export default function Explorer({ start }: { start: string }) {
  const host = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  const expanded = useRef(new Set<string>());
  const [showLiterals, setShowLiterals] = useState(true);
  const [status, setStatus] = useState("Loading…");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const showLiteralsRef = useRef(showLiterals);
  showLiteralsRef.current = showLiterals;

  async function expand(iri: string) {
    const graph = cy.current;
    if (!graph || expanded.current.has(iri)) return;
    expanded.current.add(iri);
    setStatus("Loading…");
    const response = await fetch(`/api/neighbors?uri=${encodeURIComponent(iri)}`);
    if (!response.ok) return setStatus("Could not load neighbours.");
    const data: { nodes: GraphNode[]; edges: GraphEdge[] } = await response.json();
    const fresh = [
      ...data.nodes.filter((n) => graph.getElementById(n.id).empty()).map((n) => ({ group: "nodes" as const, data: n })),
      ...data.edges.filter((e) => graph.getElementById(e.id).empty()).map((e) => ({ group: "edges" as const, data: e })),
    ];
    graph.add(fresh);
    graph.getElementById(iri).addClass("expanded");
    graph.nodes('[kind = "literal"]').style("display", showLiteralsRef.current ? "element" : "none");
    graph.layout({ name: "cose", animate: false, nodeDimensionsIncludeLabels: true, randomize: false, fit: true, padding: 30 }).run();
    setStatus(`${graph.nodes().length} nodes · ${graph.edges().length} edges. Click a coloured node to expand it, double-click to open its page.`);
  }

  useEffect(() => {
    let destroyed = false;
    const seen = expanded.current;
    import("cytoscape").then(({ default: cytoscapeFactory }) => {
      if (destroyed || !host.current) return;
      const graph = cytoscapeFactory({ container: host.current, style: STYLE, wheelSensitivity: 0.2 });
      graph.on("tap", "node", (event) => {
        const data = event.target.data() as GraphNode;
        if (data.kind === "resource") expand(data.id);
        if (data.kind === "external") window.open(data.id, "_blank", "noopener");
      });
      graph.on("dbltap", "node", (event) => {
        const data = event.target.data() as GraphNode;
        if (data.kind === "resource" && data.href) window.location.href = data.href;
      });
      cy.current = graph;
      expand(start);
    });
    return () => {
      destroyed = true;
      seen.clear();
      cy.current?.destroy();
      cy.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  useEffect(() => {
    cy.current?.nodes('[kind = "literal"]').style("display", showLiterals ? "element" : "none");
  }, [showLiterals]);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const timer = setTimeout(() => {
      fetch(`/api/lookup?q=${encodeURIComponent(q)}`).then((r) => r.json()).then(setFound).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  function reset() {
    cy.current?.elements().remove();
    expanded.current.clear();
    expand(start);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start from a movie or person…" className="input w-72" />
          {found.length > 0 && (
            <ul className="absolute z-10 mt-1 w-72 rounded-md border border-slate-200 bg-white text-sm text-slate-900 shadow-lg">
              {found.map((f) => (
                <li key={f.iri}>
                  <a className="block px-3 py-1.5 hover:bg-slate-100" href={`/explore?uri=${encodeURIComponent(f.iri)}`}>
                    {f.label} <span className="text-xs text-slate-500">{f.kind}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showLiterals} onChange={(e) => setShowLiterals(e.target.checked)} /> Show literals
        </label>
        <button type="button" className="btn" onClick={reset}>Reset</button>
      </div>
      <p className="text-sm text-slate-500">{status}</p>
      <div ref={host} className="h-[620px] w-full rounded-xl border border-slate-200 bg-white dark:border-slate-800" />
      <ul className="flex flex-wrap gap-4 text-xs text-slate-500">
        {Object.entries(COLORS).map(([name, color]) => (
          <li key={name} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} /> {name}
          </li>
        ))}
        <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-slate-500" /> External (Wikidata, DBpedia, IMDb)</li>
        <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 bg-slate-200" /> Literal</li>
      </ul>
    </div>
  );
}
```

File: `web/src/app/explore/page.tsx`
```tsx
import Explorer from "@/components/explorer";
import { PageHeader } from "@/components/ui";
import { MO, RESOURCE } from "@/lib/config";
import { isSafeIri } from "@/lib/rdf";

export const metadata = { title: "Explore the graph" };

const DEFAULT = `${RESOURCE}movie/tt0107290`;

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { uri } = await searchParams;
  const candidate = typeof uri === "string" ? uri : "";
  const start = isSafeIri(candidate) && (candidate.startsWith(RESOURCE) || candidate.startsWith(MO)) ? candidate : DEFAULT;
  return (
    <div>
      <PageHeader eyebrow="Explore" title="Triple explorer">
        <p>
          Every circle is a resource and every arrow a triple. Click a node to load its neighbours, drag to rearrange, double-click to open its page.
          Dashed circles are other datasets reached through <code>owl:sameAs</code> — the 5th star.
        </p>
      </PageHeader>
      <Explorer start={start} />
    </div>
  );
}
```

- [ ] **Step 3: Build, start and check**

Run the build and start commands, then:
```bash
B=http://localhost:3100
curl -s "$B/api/neighbors?uri=https://lod-movie.felix-nguyen.io.vn/resource/movie/tt0107290" | head -c 400; echo
curl -s "$B/api/lookup?q=jur"; echo
curl -s -w " %{http_code}\n" "$B/api/neighbors?uri=javascript:alert(1)"
```
Expected: JSON with a `nodes` array whose first node is Jurassic Park (`cls` `Movie`) and `edges`; a lookup result for Jurassic Park; `{"error":"Invalid uri"} 400`. In a browser open `/explore`: Jurassic Park and neighbours render; clicking Steven Spielberg expands his neighbours; dragging works; the literal toggle hides literals; double-click opens a page; search box suggestions navigate. Stop the server.

- [ ] **Step 4: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): interactive triple explorer"
```

---

### Task 11: Dataset documentation page

**Files:**
- Create: `web/src/app/dataset/page.tsx`

**Interfaces:**
- Consumes: `datasetStats()`, `voidMeta()`, `EXAMPLES`, `sparqlHref`, `shorten`, `DATASET`, `ui.*`, `CopyButton`, `IriLink`.

- [ ] **Step 1: Write the page**

File: `web/src/app/dataset/page.tsx`
```tsx
import { statSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import CopyButton from "@/components/copy-button";
import { IriLink } from "@/components/term";
import { ExternalLink, PageHeader, Section, Stat } from "@/components/ui";
import { BASE, DATASET } from "@/lib/config";
import { EXAMPLES } from "@/lib/examples";
import { datasetStats, voidMeta } from "@/lib/queries";
import { sparqlHref } from "@/lib/rdf";

export const metadata = { title: "Dataset" };

const DOWNLOADS = [
  ["all.ttl.gz", "Everything: ontology, data, links and VoID (gzipped Turtle)"],
  ["data.nt", "Instance data — 4★ layer (N-Triples)"],
  ["links.nt", "Links to Wikidata and DBpedia — 5★ layer (N-Triples)"],
  ["ontology.ttl", "Ontology (Turtle)"],
  ["void.ttl", "VoID dataset description (Turtle)"],
] as const;

function size(file: string): string {
  try {
    const bytes = statSync(path.join(process.cwd(), "public", "downloads", file)).size;
    return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
  } catch {
    return "";
  }
}

export default function DatasetPage() {
  const stats = datasetStats();
  const meta = voidMeta();
  const links = stats.linksets.reduce((sum, l) => sum + l.triples, 0);
  const linksQuery = EXAMPLES.find((e) => e.title.includes("5★"))!.query;
  const stars: [string, string, React.ReactNode][] = [
    ["★", "Available on the web under an open licence", <ExternalLink key="1" href={meta.license ?? "#"}>dcterms:license</ExternalLink>],
    ["★★", "Machine-readable structured data", <a key="2" className="link" href="/downloads/all.ttl.gz">all.ttl.gz</a>],
    ["★★★", "Non-proprietary formats: Turtle, N-Triples, JSON-LD, RDF/XML", <a key="3" className="link" href="/data/movie/tt0107290.ttl">/data/movie/tt0107290.ttl</a>],
    ["★★★★", "URIs identify things and dereference (HTTP 303 + content negotiation)", <a key="4" className="link" href="/resource/movie/tt0107290">/resource/movie/tt0107290</a>],
    ["★★★★★", `Linked to other datasets: ${links.toLocaleString("en-US")} links to Wikidata and DBpedia`, <Link key="5" className="link" href={sparqlHref(linksQuery)}>SPARQL over the links graph</Link>],
  ];
  return (
    <div className="space-y-12">
      <PageHeader eyebrow="Dataset" title={meta.title ?? "LOD Movie"}>
        <p>{meta.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <code className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{DATASET}</code>
          <CopyButton text={DATASET} />
          <span className="text-slate-500">
            version {meta.version} · modified {meta.modified?.slice(0, 10)}
          </span>
        </div>
      </PageHeader>

      <Section title="5★ Linked Open Data checklist">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {stars.map(([star, text, evidence]) => (
                <tr key={star}>
                  <td className="whitespace-nowrap py-2 pr-4 text-amber-500">{star}</td>
                  <td className="py-2 pr-4">{text}</td>
                  <td className="py-2">{evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Statistics">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Triples (data + links)" value={stats.triples} />
          {Object.entries(stats.classes).map(([name, n]) => (
            <Stat key={name} label={name} value={n} />
          ))}
        </div>
      </Section>

      <Section title="Linksets" id="linksets">
        <ul className="space-y-1">
          {stats.linksets.map((l) => (
            <li key={l.target}>
              <IriLink iri={l.target} /> — {l.triples.toLocaleString("en-US")} links
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-500">
          Movies and people use <code>owl:sameAs</code> (matched on IMDb ID, Wikidata P345); genres and professions use{" "}
          <code>skos:exactMatch</code>/<code>skos:closeMatch</code>. {stats.linkedMovies} of {stats.movies} movies are on Wikidata.
        </p>
      </Section>

      <Section title="Downloads">
        <ul className="space-y-2">
          {DOWNLOADS.map(([file, text]) => (
            <li key={file} className="flex flex-wrap items-baseline gap-x-3">
              <a className="link font-mono" href={`/downloads/${file}`}>{file}</a>
              <span className="text-sm text-slate-500">{size(file)}</span>
              <span className="text-sm">{text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Access">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>SPARQL endpoint: <Link className="link" href="/sparql">{BASE}sparql</Link></li>
          <li>This dataset URI returns VoID for RDF clients: <code>curl -H &quot;Accept: text/turtle&quot; {DATASET}</code></li>
          <li>Every resource URI dereferences, e.g. <code>curl -L -H &quot;Accept: application/ld+json&quot; {BASE}resource/movie/tt0107290</code></li>
        </ul>
      </Section>

      <Section title="Provenance and licence">
        <p className="text-sm">
          Source data: the IMDb non-commercial datasets ({meta.sources.length} files). IMDb data may be used for personal and non-commercial
          purposes only. English and Vietnamese titles were translated with Claude Code; links were matched through Wikidata.
        </p>
        <ul className="list-disc pl-5 text-sm">
          {meta.sources.map((s) => <li key={s}><ExternalLink href={s}>{s}</ExternalLink></li>)}
        </ul>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Build, start and check**

Run the build and start commands, then:
```bash
B=http://localhost:3100
curl -s -H "Accept: text/html" $B/dataset | grep -o "★★★★★\|Linksets\|all.ttl.gz\|MB" | sort -u
curl -s -H "Accept: text/turtle" $B/dataset | head -3
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" $B/downloads/all.ttl.gz
```
Expected: the four strings; the start of `void.ttl`; `200` and a size around 419,000. Stop the server.

- [ ] **Step 3: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add web && git commit -m "feat(web): dataset documentation page with 5-star checklist"
```

---

### Task 12: Final verification, README and deployment

**Files:**
- Modify: `README.md` (repo root)

- [ ] **Step 1: Full manual pass on a production build**

Run the build and start commands. Repeat the curl checks from Tasks 2, 3, 5 and 7. In a browser at phone width (DevTools, 390 px) and desktop, visit `/`, `/movies`, `/people`, a movie page, a person page, `/sparql`, `/explore`, `/ontology`, `/dataset` and confirm: no horizontal page scroll, navigation wraps, dark mode (OS setting) keeps text readable. Stop the server.

- [ ] **Step 2: Document the website in the README**

Append to `README.md`:
````markdown
## Website (`web/`)

Next.js app that serves `dist/` as Linked Data at `https://lod-movie.felix-nguyen.io.vn/`:

| URL | What |
|---|---|
| `/sparql` | SPARQL 1.1 endpoint (GET/POST) and YASGUI editor |
| `/resource/{type}/{id}` | Linked Data URIs — 303 to `/page/…` (HTML) or `/data/….ttl|jsonld|nt|rdf` |
| `/ontology`, `/dataset` | Ontology and VoID URIs — HTML or RDF by `Accept` |
| `/movies`, `/people`, `/search` | Browse and search |
| `/explore` | Interactive triple explorer |

```bash
cd web
npm install
npm run dev        # http://localhost:3000 (copies ../dist first)
npm run build && npm start
```

Deploy: Vercel project with root directory `web/` and "Include files outside the root directory" enabled.
New data: run the pipeline, commit `dist/`, push — Vercel rebuilds the site.
````

- [ ] **Step 3: Commit**

```bash
cd d:/KHDL/semantic-web/code && git add README.md && git commit -m "docs: website usage and deployment"
```

- [ ] **Step 4: Deployment (needs the user)**

These steps publish the site and need the user's accounts; confirm with the user before running any `git push`:
1. User creates an empty GitHub repository and shares its URL.
2. Integrate the branches the user chooses (e.g. merge `web` — which contains `pipeline` — into `master`), then `git remote add origin <url>` and `git push -u origin master`.
3. In Vercel: "Add New… → Project" → import the repository → Root Directory `web` → Framework preset Next.js → confirm "Include files outside the root directory in the Build Step" is enabled → Deploy.
4. Vercel project → Settings → Domains → add `lod-movie.felix-nguyen.io.vn`.
5. Repeat the Step 1 checks against `https://lod-movie.felix-nguyen.io.vn`.
