# LOD Movie — Sub-project 2: Website & SPARQL Endpoint (Design)

- **Date:** 2026-09-28
- **Status:** Draft for review
- **Scope:** Capstone requirement 5 ("provide an interface via SPARQL endpoint/terminal to query data")
  and the public demo of the whole dataset. Builds on sub-project 1
  (`docs/superpowers/specs/2026-09-28-lod-movie-pipeline-design.md`), whose `dist/` is the only input.

## 1. Goal and context

A public website at `https://lod-movie.felix-nguyen.io.vn/` that serves the LOD Movie dataset as real
Linked Data: every URI in the dataset resolves, a standard SPARQL 1.1 endpoint answers queries, and
people can browse, search and visualise the data. It is the live demo for graders.

**Success criteria**

1. `https://lod-movie.felix-nguyen.io.vn/sparql` is a working SPARQL 1.1 Protocol endpoint (GET and
   POST) usable from any SPARQL client, and shows a query editor (YASGUI) in a browser.
2. Every resource URI (`/resource/...`), the ontology URI (`/ontology`) and the dataset URI
   (`/dataset`) dereference: HTML for browsers, RDF (Turtle / JSON-LD / N-Triples / RDF/XML) for
   machines, via HTTP content negotiation.
3. Movies and people can be browsed, filtered and searched; each has a readable page.
4. The ontology and any resource's neighbourhood can be explored as an interactive, draggable graph.
5. Movie and person pages demonstrate 5★ value with a live "From Wikidata" panel reached through
   `owl:sameAs`.
6. Deployed on Vercel from GitHub; adding movies = rebuild `dist/` → push → redeploy.

**Decisions made in brainstorming**

- UI language: English only (movie pages still show the Vietnamese title).
- Stack: Next.js 16 (App Router, TypeScript) on Vercel; in-memory Oxigraph (WebAssembly) store.
- Query editor: YASGUI (`@zazuko/yasgui`).
- Live Wikidata enrichment panel on movie and person pages (nothing stored in our dataset).
- Deployment: GitHub repository + Vercel Git integration, project root directory `web/`.

**Non-goals**

- Writing data (SPARQL UPDATE, uploads), user accounts, authentication.
- Federated `SERVICE` queries from our endpoint.
- Vietnamese UI / i18n, analytics, comments.
- Storing any Wikidata facts in the dataset.

## 2. Inputs (from sub-project 1)

`dist/ontology.ttl`, `dist/data.nt` (97k triples), `dist/links.nt` (7k), `dist/void.ttl`,
`dist/all.ttl.gz`. Measured with Oxigraph 0.5.11 on Node 24: loading all four RDF files takes
**~0.4 s**; a label search over all movies takes ~30 ms; `COUNT(*)` over 104,482 triples ~40 ms.

Oxigraph serialises query results natively as SPARQL JSON / XML / CSV / TSV and graphs as Turtle,
N-Triples, JSON-LD and RDF/XML (verified). `Store.query()` rejects SPARQL UPDATE.

## 3. Architecture

```
repo/
  dist/                      ← sub-project 1 output (committed)
  web/                       ← this sub-project (Vercel root directory)
    scripts/prepare-data.mjs ← prebuild: copies ../dist into web/data and web/public/downloads
    data/                    ← generated, git-ignored; bundled into server functions
    public/downloads/        ← generated, git-ignored; static download files
    src/lib/…                ← store, SPARQL, content negotiation, queries, Wikidata client
    src/app/…                ← routes (pages and route handlers)
    src/components/…         ← UI components (client components for YASGUI, Cytoscape, Wikidata panel)
```

### 3.1 Triple store (`src/lib/store.ts`)

- One module-level singleton `getStore()`: on first call, reads the four files from `web/data/` and
  loads them into an Oxigraph `Store`, each into its own named graph:

  | Graph IRI | File |
  |---|---|
  | `https://lod-movie.felix-nguyen.io.vn/graph/data` | `data.nt` |
  | `https://lod-movie.felix-nguyen.io.vn/graph/links` | `links.nt` |
  | `https://lod-movie.felix-nguyen.io.vn/graph/ontology` | `ontology.ttl` |
  | `https://lod-movie.felix-nguyen.io.vn/graph/void` | `void.ttl` |

- Every query runs with `use_default_graph_as_union: true`, so plain queries see all data, and
  `GRAPH <…/graph/links> { … }` isolates the 5★ layer.
- Later requests in the same server instance reuse the loaded store (cold start ≈ 0.5 s).
- Data files are included in every server function via `outputFileTracingIncludes` in
  `next.config.ts`.

### 3.2 Build and data flow

1. `npm run build` runs `prebuild` → `scripts/prepare-data.mjs` copies `../dist/{ontology.ttl,
   data.nt, links.nt, void.ttl}` to `web/data/` and all of `../dist/*` (except reports) to
   `web/public/downloads/`. Missing `dist` files fail the build with a clear message.
2. `next build` pre-renders static pages and the 300 movie pages (`generateStaticParams`).
3. Data only changes on deploy, so dynamic pages render on first request and stay cached until the
   next deployment. Person, genre, profession and credit pages render on demand.

## 4. URLs and Linked Data behaviour

### 4.1 Content negotiation (`src/lib/conneg.ts`)

The `Accept` header is parsed with q-values. Supported RDF media types and file extensions:

| Media type | Extension |
|---|---|
| `text/turtle` | `.ttl` |
| `application/ld+json` | `.jsonld` |
| `application/n-triples` | `.nt` |
| `application/rdf+xml` | `.rdf` |

Rule: if the best-ranked acceptable type is one of these RDF types, the client wants RDF; otherwise
(including `text/html`, `*/*`, missing header) it wants HTML. Ties prefer HTML. All negotiated
responses send `Vary: Accept`.

### 4.2 Routes

| URL | Behaviour |
|---|---|
| `/` | Home: live dataset statistics, search box, entry points to every feature |
| `/movies` | Browse/filter/search movies |
| `/people` | Browse/filter/search people |
| `/resource/{type}/{id}` | **Linked Data URI.** `303 See Other` → `/page/{type}/{id}` (HTML) or `/data/{type}/{id}.{ext}` (RDF). `404` if the resource has no triples |
| `/page/{type}/{id}` | HTML view (movie, person, genre, profession, credit; generic view for anything else) |
| `/data/{type}/{id}.{ext}` | RDF description of the resource (§4.3) in the format of the extension; `404` if unknown |
| `/ontology` | Ontology URI (hash namespace `…/ontology#Term`). HTML → ontology docs page; RDF → `ontology.ttl` in the negotiated format. `200` with `Vary: Accept` (hash URIs need no 303) |
| `/dataset` | VoID dataset URI. HTML → dataset docs page; RDF → the VoID graph in the negotiated format. `200` with `Vary: Accept` |
| `/sparql` | SPARQL endpoint (§5). Browser without `query` → YASGUI page |
| `/explore?uri=…` | Interactive triple-graph explorer (§6.4); default start: Jurassic Park |
| `/downloads/…` | Static files: `all.ttl.gz`, `ontology.ttl`, `data.nt`, `links.nt`, `void.ttl` |
| `/api/neighbors?uri=…` | JSON: triples around one resource, for the explorer |
| `/api/wikidata/{qid}` | JSON: a few live Wikidata facts, cached 24 h (§6.5) |

`{type}` ∈ `movie | person | genre | profession | credit | scheme`; `{id}` is validated against
`^[A-Za-z0-9-]+$` before being used to build an IRI.

### 4.3 Resource description

For resource `R`: all triples `R ?p ?o` (all graphs) plus incoming triples `?s ?p R` (capped at
500), as a `CONSTRUCT` query serialised by Oxigraph. Turtle output uses the dataset's prefixes.

## 5. SPARQL endpoint (`/sparql`)

- **Protocol:** SPARQL 1.1 Protocol query operation — `GET ?query=…`, `POST`
  `application/x-www-form-urlencoded` (`query=…`), `POST application/sparql-query` (raw body).
  `default-graph-uri` / `named-graph-uri` parameters are not supported (`400`).
- **Result formats** (from `Accept`, or an explicit `format=json|xml|csv|tsv|ttl|jsonld|nt|rdf`
  parameter): SELECT/ASK → `application/sparql-results+json` (default), `…+xml`, `text/csv`,
  `text/tab-separated-values`; CONSTRUCT/DESCRIBE → `text/turtle` (default), JSON-LD, N-Triples,
  RDF/XML.
- **Browser UI:** `GET /sparql` with no `query` and an HTML `Accept` renders the YASGUI page.
- **Read-only:** only query forms are executed; UPDATE is rejected with `400`.
- **Limits:**
  - Queries are parsed with `sparqljs`; if a SELECT/CONSTRUCT/DESCRIBE has no `LIMIT` or one above
    **10,000**, the endpoint sets `LIMIT 10000` and adds response header
    `X-LOD-Result-Limit: 10000`. Parse errors → `400` with the parser message.
  - Responses larger than 4 MB (Vercel's response limit is 4.5 MB) → `413` with advice to add
    `LIMIT` or narrow the query.
  - Function `maxDuration` 10 s; a query running longer is terminated by the platform (`504`).
- **CORS:** `Access-Control-Allow-Origin: *` on GET/POST/OPTIONS so other sites and notebooks can
  query it.
- **YASGUI page:** endpoint preset to `/sparql`; prefixes preset (`mo`, `rdfs`, `owl`, `skos`,
  `schema`, `wd`, `dbr`, `void`, `xsd`); a sidebar of ~10 example queries that open in the editor:
  1. Top-rated movies with English and Vietnamese titles
  2. Movies of a genre by year
  3. A director's filmography
  4. Cast of a movie with character names (through `mo:Credit`)
  5. Most prolific actors in the dataset
  6. Movies linked to Wikidata and DBpedia (`GRAPH <…/graph/links>`)
  7. Genres and their Wikidata/DBpedia matches (SKOS)
  8. Class and property usage counts (ontology introspection)
  9. VoID statistics and linksets
  10. People born in a decade with their professions
- The same example queries are reused on the dataset docs page and in "view this query" links.

## 6. Pages and components

Layout: header navigation (Movies · People · SPARQL · Explore · Ontology · Dataset), footer with IMDb
attribution, licence note and GitHub link. Tailwind CSS; readable on phones; light and dark themes via
`prefers-color-scheme`.

### 6.1 Home (`/`)

Dataset name and one-line pitch; statistic tiles computed by SPARQL (movies, people, credits,
triples, % movies linked to Wikidata, number of links); search box (movies + people); cards to
every feature; a "try a query" snippet that opens example 1 in the editor.

### 6.2 Browse (`/movies`, `/people`)

- Movies: text search on English/Vietnamese/original titles, genre filter (19), year range, minimum
  rating, sort (rating, votes, year, title), 24 per page. Card shows English + Vietnamese title,
  year, rating, genres.
- People: name search, profession filter, sort by name or number of movies in the dataset, 48 per page.
- All filtering is done by SPARQL built in `src/lib/queries.ts`; each list page has a
  "View this query" link that opens the exact query in YASGUI (teaching aid).
- Filter state lives in the URL query string (shareable, back-button friendly).

### 6.3 Resource pages (`/page/…`)

- **Movie:** English title, Vietnamese title, original title (if different); year, runtime, rating
  and votes; genre chips; directors, writers; cast table (billing order, person, character) and crew
  credits (role, person, job); outbound links (Wikidata, DBpedia, IMDb); "From Wikidata" panel;
  buttons: download RDF (TTL / JSON-LD / N-Triples), "Explore graph", "View as SPARQL".
- **Person:** name, birth/death years, professions; filmography in the dataset grouped by role;
  "known for"; outbound links; "From Wikidata" panel; same buttons.
- **Genre / Profession:** label, SKOS matches (Wikidata, DBpedia), target-genre flag, list of movies
  (genre) or people (profession).
- **Credit:** movie, person, role, characters, job, billing order.
- **Generic:** any other IRI in our namespace — table of outgoing and incoming triples.
- Every page shows its canonical URI (`/resource/...`) with a copy button, and IRIs in tables link to
  their own pages (our namespace) or open externally (others).

### 6.4 Visualisations (Cytoscape.js, client components)

- **Ontology diagram** (on `/ontology`): nodes = our classes; edges = object properties from domain to
  range, labelled; dashed edges/nodes for alignments to external vocabularies (`schema:Movie`,
  `dbo:Film`, `foaf:Person`, `skos:Concept`); datatype properties listed when a class node is
  selected. Draggable nodes, zoom/pan, "reset layout" button. Built from the ontology graph by SPARQL
  at render time, so the diagram always matches `ontology.ttl`.
- **Triple explorer** (`/explore`): starts from one resource and shows its neighbours from
  `/api/neighbors`. Resources coloured by class, literals as small boxes (toggle to hide literals),
  external IRIs (Wikidata/DBpedia) as distinct nodes that open in a new tab. Click a resource node =
  expand its neighbours (≤ 50 edges per expansion, deduplicated); double-click = open its page;
  drag to rearrange; search box to pick a start movie/person; "reset". Layout: force-directed
  (`cose`).
- The ontology page also lists every term as a section with anchor `#Term` (label, comment, domain,
  range, super-class/property, inverse), so `…/ontology#Movie` lands on its documentation.

### 6.5 "From Wikidata" panel

- Client component on movie and person pages; fetches `/api/wikidata/{qid}` after the page renders
  (the page never waits for Wikidata).
- `/api/wikidata/{qid}` (QID validated `^Q\d+$`) runs one SPARQL query against
  `https://query.wikidata.org/sparql` with a descriptive User-Agent and a 5 s timeout. Fields:
  - Movie: image (P18) or poster, country of origin (P495), publication date (P577), awards received
    count (P166), Wikipedia article link.
  - Person: image (P18), date of birth (P569), place of birth (P19), country of citizenship (P27),
    Wikipedia article link.
- Response cached 24 h (`revalidate: 86400`). Images shown via Wikimedia Commons `Special:FilePath`
  thumbnails with attribution link.
- Panel is labelled "Live from Wikidata via owl:sameAs" and shows the `owl:sameAs` triple it followed.
  On error/timeout: "Wikidata is not reachable right now" — the rest of the page is unaffected.

### 6.6 Dataset docs (`/dataset`)

- 5★ checklist: each star with how this dataset satisfies it and a link to evidence (licence, formats,
  a resource URI, a SPARQL query over links).
- Statistics and linksets read from the VoID graph by SPARQL.
- Downloads with sizes; dataset URI, endpoint URI, `void.ttl` link; how to cite; data provenance
  (IMDb non-commercial datasets) and the licence note.

## 7. Error handling

| Situation | Behaviour |
|---|---|
| Unknown resource (`/resource`, `/page`, `/data`) | `404` page / `404` RDF response; no redirect |
| Invalid `{type}` / `{id}` | `404` |
| SPARQL syntax error | `400`, body = parser message (plain text) |
| SPARQL UPDATE or unsupported protocol parameter | `400` with explanation |
| Result too large | `413` with advice |
| Query exceeds 10 s | platform `504`; documented on the SPARQL page |
| Unsupported `Accept` on RDF routes | `406` listing supported types |
| Wikidata slow/down | panel message; page unaffected; errors not cached |
| Data files missing at build | build fails in `prebuild` with the missing file names |
| Store fails to load at runtime | `500` page "dataset unavailable"; logged |

## 8. Verification

By the user's decision there is **no automated test suite and no smoke-test script** for this
sub-project. Verification is:

- **Build check:** `npm run build` succeeds (type errors and pre-rendering failures).
- **Manual checks during development** (not committed): `curl` requests against `npm start` for the
  303 redirects, RDF formats, `/ontology` and `/dataset` negotiation, and the SPARQL endpoint with
  each result format, `LIMIT` injection and UPDATE rejection.
- **Manual browser check** before deploy and after deploy on the live domain: YASGUI runs an
  example; browse filters work; ontology diagram and explorer render, drag and expand; Wikidata panel
  loads; layout works at phone width.

## 9. Deployment

- Push the repository to GitHub (created by the user). In Vercel: import the repo, root directory
  `web/`, framework Next.js, "Include files outside the root directory" enabled (needed for
  `../dist`). No environment variables are required.
- Assign domain `lod-movie.felix-nguyen.io.vn` to the project (DNS already points to Vercel).
- After deploy, repeat the manual checks (§8) on `https://lod-movie.felix-nguyen.io.vn`.
- Redeploy flow for new data: run the pipeline → commit `dist/` → push → Vercel rebuilds.

## 10. Growth and limits

- The in-memory design is comfortable to ~1M triples (≈ 10× today). Beyond that, move to a hosted
  triple store behind the same `/sparql` URL (sub-project 1 spec §9).
- Pre-rendering is only done for movies; if the movie count grows a lot, switch movies to on-demand
  rendering too (one-line change).

## 11. Open items

- The GitHub repository name/owner (user creates it at deployment time).
- Licence wording on the site follows the value confirmed with the instructor (sub-project 1 §13).
