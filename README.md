# LOD Movie

Linked Open Data about 300 IMDb movies (1980–2025), their principal cast and crew, genres and
credits — linked to Wikidata and DBpedia, with English and Vietnamese titles.

- Base URI: `https://lod-movie.felix-nguyen.io.vn/`
- Design: `docs/superpowers/specs/2026-09-28-lod-movie-pipeline-design.md`

## Layout

| Path | What |
|---|---|
| `data/` | Raw IMDb crawl (input, never modified) |
| `ontology/movie.ttl` | OWL ontology (`mo:`) |
| `shapes/movie-shapes.ttl` | SHACL data-quality rules |
| `mappings/` | Genre / profession → Wikidata + DBpedia |
| `translations/movie_titles.csv` | English + Vietnamese titles (`source`: machine / reviewed) |
| `links/` | Wikidata link store (one row per checked IMDb ID) |
| `pipeline/` | Build code |
| `dist/` | Published dataset: `ontology.ttl`, `data.nt` (4★), `links.nt` (5★), `void.ttl`, `all.ttl.gz`, reports |

## Setup

```bash
py -3.14 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m pytest
```

## Build

```bash
.venv/Scripts/python -m pipeline.build            # checks new IDs against Wikidata, writes dist/
.venv/Scripts/python -m pipeline.build --offline  # no network, uses links/
.venv/Scripts/python -m pipeline.build --refresh  # re-check every ID against Wikidata
```

## Adding more movies

1. Put the new crawl (same CSV layout) in its own folder, e.g. `data-2027/`.
2. `python -m pipeline.translate --todo --input data --input data-2027` → `translations/todo.csv`.
3. Ask Claude Code to fill `title_en` / `title_vi` in `todo.csv`, then
   `python -m pipeline.translate --merge --input data --input data-2027`.
4. `python -m pipeline.build --input data --input data-2027` — only new IDs are sent to Wikidata;
   existing URIs and links do not change.

To correct a title, edit `translations/movie_titles.csv` and set `source` to `reviewed`.

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
