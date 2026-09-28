# LOD Movie — Sub-project 1: Data Pipeline (Design)

- **Date:** 2026-09-28
- **Status:** Draft for review
- **Scope:** Capstone requirements 1–4 (ontology, data, 4★ transformation, 5★ linking).
  Requirement 5 (SPARQL endpoint + demo website on Vercel) is **sub-project 2**, specified separately.

## 1. Goal and context

Build a Linked Open Data dataset about movies from an existing IMDb crawl (`data/`), as a
graded semantic-web capstone. The student must be able to explain and defend every artifact,
so the ontology and the transformation are written from scratch; the crawler's `data/movies.ttl`
is used only as a reference.

**Success criteria**

1. A standalone, documented OWL ontology that reuses standard vocabularies.
2. A reproducible build (`python -m pipeline.build`) turning the CSV crawl into RDF (4★).
3. A separate link layer connecting movies, people, genres and professions to Wikidata and
   DBpedia (5★), with measured coverage.
4. All output passes SHACL validation; the build refuses to publish invalid data.
5. The dataset can grow: later crawls are added without changing existing URIs or re-querying
   already-linked IDs.
6. Every movie has an English and a Vietnamese title (language-tagged `@en` / `@vi`),
   translated by Claude Code and stored in our dataset.

**Non-goals**

- Importing facts (posters, plots, countries) from Wikidata — the dataset links out only.
- Titles in languages other than English and Vietnamese; multilingual person names.
- Serving/deploying anything — that is sub-project 2.
- Changing the crawler or the raw files in `data/`.

## 2. Input data (current crawl)

Source: IMDb non-commercial datasets (see `data/manifest.json`). 300 movies (1980–2025,
50 sampled per target genre: Action, Comedy, Drama, Horror, Romance, Sci-Fi), 5,476 people,
6,204 principal credits, 19 genres. Quality report: no missing core fields.

Files used: `movies.csv`, `people.csv`, `movie_genres.csv`, `movie_people.csv`,
`principal_credits.csv`, `genres.csv`, `sampling.csv`, `manifest.json`.
All CSVs are UTF-8 **with BOM** (`encoding="utf-8-sig"`); list columns are JSON arrays.

Observed facts shaping the design:

- `is_adult` is always false, `title_type` always `movie`, `end_year` always empty → dropped.
- No title variants in this crawl → dropped.
- Credit categories (12): actor, actress, producer, writer, composer, editor, director,
  cinematographer, casting_director, production_designer, self, archive_footage.
- Person professions: 41 distinct values; credit categories are (almost) a subset.
- `movie_people.csv` has directors/writers from `title.crew` that are not in principals
  (69 crew-only rows), so shortcut properties come from `movie_people.csv`, while `mo:Credit`
  nodes come from `principal_credits.csv`.

## 3. URI scheme

Base: `https://lod-movie.felix-nguyen.io.vn/`. URIs are derived **only** from IMDb IDs or
slugs of source values — never from row order — so they are stable across rebuilds.

| Resource | Pattern | Example |
|---|---|---|
| Ontology (prefix `mo:`) | `/ontology#<Term>` | `…/ontology#Movie` |
| Movie | `/resource/movie/<tconst>` | `…/resource/movie/tt0081633` |
| Person | `/resource/person/<nconst>` | `…/resource/person/nm0000025` |
| Genre | `/resource/genre/<slug>` | `…/resource/genre/sci-fi` |
| Profession / role | `/resource/profession/<slug>` | `…/resource/profession/casting-director` |
| Credit | `/resource/credit/<tconst>-<ordering>` | `…/resource/credit/tt0081633-3` |
| Genre scheme | `/resource/scheme/genres` | |
| Profession scheme | `/resource/scheme/professions` | |
| Dataset (VoID) | `/dataset` | |

Slug rule: lowercase; any run of non-alphanumeric characters → `-`; trim `-`.
(`Sci-Fi` → `sci-fi`, `casting_director` → `casting-director`.)

Dereferencing these URIs (HTML / Turtle / JSON-LD) is implemented in sub-project 2.

## 4. Ontology (`ontology/movie.ttl`)

OWL 2, one document, hash namespace `https://lod-movie.felix-nguyen.io.vn/ontology#`.
Header: `owl:Ontology` with `dcterms:title`, `dcterms:description`, `dcterms:creator`,
`dcterms:created`, `owl:versionInfo "1.0.0"`. Every term has `rdfs:label`, `rdfs:comment`,
and (for properties) `rdfs:domain` / `rdfs:range`.

### Classes

| Class | Alignment | Notes |
|---|---|---|
| `mo:Movie` | `rdfs:subClassOf schema:Movie`; `owl:equivalentClass dbo:Film` | |
| `mo:Person` | `rdfs:subClassOf schema:Person, foaf:Person` | |
| `mo:Genre` | `rdfs:subClassOf skos:Concept` | Genres are individuals, not Movie subclasses |
| `mo:Profession` | `rdfs:subClassOf skos:Concept` | Used for both credit roles and person professions |
| `mo:Credit` | — | N-ary relation: movie × person × role × character × order |

Concept schemes: `…/scheme/genres` and `…/scheme/professions` (`skos:ConceptScheme`);
each concept has `skos:prefLabel` and `skos:inScheme`. Genres with
`is_target_category = True` additionally get `mo:isTargetGenre true`.

### Object properties

| Property | Domain → Range | Alignment / axioms |
|---|---|---|
| `mo:hasGenre` | Movie → Genre | `rdfs:subPropertyOf schema:genre` |
| `mo:directedBy` | Movie → Person | `subPropertyOf schema:director`; `owl:inverseOf mo:directorOf` |
| `mo:hasActor` | Movie → Person | `subPropertyOf schema:actor`; `owl:inverseOf mo:actedIn` |
| `mo:writtenBy` | Movie → Person | `subPropertyOf schema:author`; `owl:inverseOf mo:writerOf` |
| `mo:hasCredit` | Movie → Credit | `owl:inverseOf mo:creditFor` |
| `mo:creditedPerson` | Credit → Person | functional |
| `mo:creditRole` | Credit → Profession | functional |
| `mo:primaryProfession` | Person → Profession | |
| `mo:knownFor` | Person → Movie | Emitted only when the movie is in the dataset |
| `mo:sampledForGenre` | Movie → Genre | Sampling provenance from `sampling.csv` |

Only the forward direction of inverse pairs is materialized in the data; the inverses are
declared in the ontology for reasoning and documentation.

### Datatype properties

| Property | Domain | Range |
|---|---|---|
| `rdfs:label`, `schema:name` | Movie | `rdf:langString` — exactly one `@en` and one `@vi` (see §5a) |
| `rdfs:label`, `schema:name` | Person | `xsd:string`, no language tag (names are not translated) |
| `mo:primaryTitle` | Movie | `xsd:string` — IMDb primary title as crawled, language unknown |
| `mo:originalTitle` | Movie | `xsd:string` |
| `mo:releaseYear` | Movie | `xsd:integer` |
| `mo:runtimeMinutes` | Movie | `xsd:integer` |
| `mo:averageRating` | Movie | `xsd:decimal` |
| `mo:numVotes` | Movie | `xsd:integer` |
| `mo:imdbId` | Movie, Person | `xsd:string` |
| `mo:birthYear`, `mo:deathYear` | Person | `xsd:integer` |
| `mo:characterName` | Credit | `xsd:string` (one triple per character) |
| `mo:billingOrder` | Credit | `xsd:integer` |
| `mo:job` | Credit | `xsd:string` (only when non-empty) |
| `mo:isTargetGenre` | Genre | `xsd:boolean` |

Years are `xsd:integer` rather than `xsd:gYear` so SPARQL filters stay simple
(`FILTER(?year >= 2000)`); the `rdfs:comment` states they denote calendar years.

Movies and people also get `rdfs:seeAlso` and `foaf:isPrimaryTopicOf` → their IMDb page
(IMDb is not RDF, so it is never an `owl:sameAs` target).

## 5. Transformation (4★) — `pipeline/transform.py`

Input: typed records from `load.py`. Output: `rdflib.Graph` for `dist/data.nt`.

- One `mo:Movie` per `movies.csv` row; one `mo:Person` per `people.csv` row.
- `movie_genres.csv` → `mo:hasGenre`; genre concepts from `genres.csv` ∪ genres seen in data.
- `movie_people.csv` → `mo:directedBy` / `mo:hasActor` / `mo:writtenBy` by `role`.
- `principal_credits.csv` → `mo:Credit` nodes + `mo:hasCredit`; `characters` JSON array →
  one `mo:characterName` each.
- Profession concepts = union of all `primary_professions` values and credit categories.
- Empty values produce no triple (unknown ≠ false). No blank nodes anywhere.
- Movie labels come from `translations/movie_titles.csv` (§5a). A movie with no translation
  row gets only `mo:primaryTitle` plus a fallback `rdfs:label` without a language tag, and a
  build warning.

## 5a. Bilingual movie titles (English + Vietnamese) — `translations/movie_titles.csv`

The crawl has no translated titles (`with_akas: false`), so we produce them ourselves and store
them **inside our dataset**. The translation is done **by Claude Code in a working session**
(no API key, no API script, no cost); the pipeline only reads the result.

### Translation store

`translations/movie_titles.csv` (committed, human-editable):

| Column | Meaning |
|---|---|
| `imdb_id` | `tt…` |
| `primary_title` | Source title the translation was made from (to detect changes) |
| `title_en` | English title |
| `title_vi` | Vietnamese title |
| `source` | `machine` (translated by Claude Code) or `reviewed` (checked/edited by a person) |
| `translated_at` | ISO date |

- To correct a title: edit the CSV and set `source` to `reviewed`. Reviewed rows are never
  replaced when re-translating.

### Translation rules (used by Claude Code)

- If a well-known official English / Vietnamese release title exists, use it; otherwise give
  a natural translation (not word-for-word). Keep proper names (people, places, franchises).
- `title_en` equals the primary title when that is already English; otherwise use the
  English release title or translate `original_title`.
- Context per movie: primary title, original title, year, genres.
- Vietnamese uses proper diacritics, UTF-8, sentence-style capitalisation.

### Worklist helper — `pipeline/translate.py` (no network)

`python -m pipeline.translate --todo [--input DIR ...]` writes `translations/todo.csv` with
the movies that need translating (no row, or `primary_title` changed and not `reviewed`), plus
context columns (`original_title`, `year`, `genres`). Claude Code fills in `title_en` /
`title_vi`, then `python -m pipeline.translate --merge` validates the rows (every ID known,
both titles non-empty, no duplicates) and merges them into `movie_titles.csv` with
`source = machine`. This makes translating future imports a repeatable two-command step.

### RDF output

```turtle
<…/resource/movie/tt0081633>
    mo:primaryTitle "Time Bandits" ;
    mo:originalTitle "Time Bandits" ;
    rdfs:label "Time Bandits"@en , "<Vietnamese title>"@vi ;
    schema:name "Time Bandits"@en , "<Vietnamese title>"@vi .
```

Provenance: per-title origin lives in the CSV (`source`); `void.ttl` states that English and
Vietnamese labels were translated with Claude Code unless marked reviewed, and reports the count
of machine vs reviewed titles.

## 6. Linking (5★) — `pipeline/link.py`

Output: `rdflib.Graph` for `dist/links.nt`.

### 6.1 Movies and people → Wikidata → DBpedia

Batched SPARQL (≤200 IDs per request) to `https://query.wikidata.org/sparql`:

```sparql
SELECT ?imdb ?item ?article WHERE {
  VALUES ?imdb { "tt0081633" "nm0000025" }
  ?item wdt:P345 ?imdb .
  OPTIONAL { ?article schema:about ?item ;
                      schema:isPartOf <https://en.wikipedia.org/> . }
}
```

- Match → `owl:sameAs wd:Q…`.
- English Wikipedia article `https://en.wikipedia.org/wiki/<Title>` →
  `owl:sameAs <http://dbpedia.org/resource/<Title>>` (same path segment).
- Several QIDs for one IMDb ID → keep the lowest numeric QID, log the others.
- No match → no link; recorded as unmatched.

### 6.2 Genres and professions → hand-checked mappings

`mappings/genres.csv` and `mappings/professions.csv` with columns
`source_value, wikidata_qid, dbpedia_resource, match_type` (`exact` | `close`) →
`skos:exactMatch` / `skos:closeMatch`. `owl:sameAs` is **not** used for SKOS concepts.
Vague values (e.g. `miscellaneous`) may be left unmapped.

### 6.3 Link store, cache and incremental behaviour

- `links/movies.csv`, `links/people.csv` (committed): one row per **checked** IMDb ID —
  `imdb_id, wikidata_qid, enwiki_title, checked_at` (empty QID = checked, no match).
  This is the source of truth for incremental linking.
- `links/cache/` (git-ignored): raw Wikidata JSON responses, for debugging only.
- Default build: query only IDs absent from the link store. `--refresh` re-checks all IDs.
- Offline / Wikidata failure: warn, build with the existing link store, report unlinked count.
- HTTP etiquette: descriptive `User-Agent` with contact, ~1 s pause between batches,
  exponential backoff with retries on 429 / 5xx (honour `Retry-After`).

### 6.4 Vocabulary-level links

Covered by the ontology alignment (§4): schema.org, DBpedia ontology, FOAF, SKOS.

### 6.5 Link report — `dist/link_report.json`

Per entity type: total, linked to Wikidata, linked to DBpedia, percentage, list of unmatched
IDs; mapped vs unmapped genres/professions.

## 7. Dataset description — `pipeline/void.py`

`dist/void.ttl`: `void:Dataset` (also `dcat:Dataset`) at `…/dataset` with
`dcterms:title`, `dcterms:description`, `dcterms:license` (from config), `dcterms:source`
(IMDb dataset URLs from `manifest.json`), `dcterms:modified` (build time),
`owl:versionInfo` (dataset version from config), `void:uriSpace`, `void:vocabulary`,
`void:exampleResource`, `void:sparqlEndpoint …/sparql` (served by sub-project 2),
**computed** `void:triples`, `void:entities`, per-class `void:classPartition`, and one
`void:Linkset` each for Wikidata and DBpedia with `void:linkPredicate` and triple counts.

## 8. Validation — `pipeline/validate.py` + `shapes/movie-shapes.ttl`

Run on ontology + data + links combined; the build fails on any violation.

SHACL shapes:

- `mo:Movie`: `rdfs:label` with `sh:uniqueLang true`; exactly one `mo:primaryTitle`,
  `mo:imdbId` (pattern `^tt\d+$`), `mo:releaseYear`; **warning-severity** shape: has one
  `@en` and one `@vi` label (missing translations warn, they do not fail the build);
  ≥1 `mo:hasGenre` of class `mo:Genre`; optional numeric fields have correct datatype;
  `mo:averageRating` within 0–10.
- `mo:Person`: exactly one `rdfs:label`, `mo:imdbId` (pattern `^nm\d+$`).
- `mo:Credit`: exactly one `mo:creditedPerson` (class `mo:Person`), `mo:creditRole`
  (class `mo:Profession`), `mo:billingOrder`; exactly one incoming `mo:hasCredit`.
- `owl:sameAs` objects are IRIs starting with `http://www.wikidata.org/entity/Q` or
  `http://dbpedia.org/resource/`.

Plus Python checks: every referenced IRI in our namespace has a type; no blank nodes.

## 9. Growth (importing more movies later)

- `--input` may be given multiple times; records merge and de-duplicate by `tconst` / `nconst`
  (later input wins on conflicting literal values; a warning is logged).
- Stable URIs (§3) + incremental link store (§6.3) → existing resources and links unchanged.
- Nothing assumes counts or a fixed genre list; unknown genres/professions become concepts and
  are reported as unmapped until added to `mappings/`.
- Every build records `dcterms:modified` and a dataset version in VoID.
- New movies: `python -m pipeline.translate --todo` lists only untranslated movies; Claude Code
  translates them; `--merge` adds them. Existing (especially reviewed) titles are untouched.
- Known ceiling for sub-project 2: in-memory serverless Oxigraph is comfortable up to
  ~1M triples (~8–10× today). Beyond that, move to a hosted triple store behind the same
  `/sparql` URL.

## 10. Code layout and build

```
code/
  data/                      # raw crawl input (read-only)
  ontology/movie.ttl
  mappings/genres.csv, professions.csv
  shapes/movie-shapes.ttl
  translations/movie_titles.csv   # en + vi titles (committed, editable)
  pipeline/
    __init__.py
    config.py      base URI, namespaces, licence, dataset version, bad-row threshold
    load.py        CSV → dataclasses; multi-input merge/dedupe; row-level warnings
    transform.py   records → data graph (4★)
    link.py        Wikidata client, link store, link graph (5★)
    translate.py   translation worklist (--todo) and validated merge (--merge); no network
    void.py        dataset description with computed stats
    validate.py    SHACL + referential checks
    build.py       CLI entry point
  links/movies.csv, people.csv   (committed); links/cache/ (ignored)
  dist/            build outputs (committed; consumed by sub-project 2)
  tests/
```

CLI: `python -m pipeline.build [--input DIR ...] [--refresh] [--offline] [--out dist]`.

Flow: load → transform → link → void → validate → write. Outputs are written to a temp
directory and moved into `dist/` only after validation passes.

`dist/` contents: `ontology.ttl`, `data.nt`, `links.nt`, `void.ttl`, `all.ttl.gz`
(everything combined), `link_report.json`, `build_report.json`.

Dependencies: `rdflib`, `pyshacl`, `requests`, `pytest` in `requirements.txt`. Target
Python 3.14 (installed); if a dependency is incompatible, pin Python 3.12 via a venv.

## 11. Error handling

| Situation | Behaviour |
|---|---|
| Malformed row (bad number, bad JSON list) | Skip row, warn with file/row/reason, count in `build_report.json`; fail if > 1% of rows (configurable) |
| Wikidata unreachable / rate-limited after retries | Warn, use existing link store, report unlinked count |
| SHACL or referential violation | Exit non-zero, print first 20 violations, leave `dist/` untouched |
| Unknown genre / profession | Create concept, warn as unmapped |
| Movie without translation row | Untagged fallback label, warn; build continues |
| Invalid rows in `todo.csv` on merge | `--merge` rejects them with reasons, merges the valid rows, exits non-zero |

Console summary: input counts, triples per layer, link coverage, warnings.

## 12. Testing

- `tests/fixtures/`: tiny CSV crawls — fixture A (3 movies) and fixture B (2 more movies, one
  overlapping person).
- Transform: exact expected triples for one movie, one person, one credit; no blank nodes;
  empty values produce no triples.
- Load: BOM handling, JSON list parsing, malformed-row skipping, multi-input dedupe.
- Link: recorded Wikidata responses (no network); lowest-QID rule; DBpedia IRI derivation;
  incremental mode queries only new IDs; offline fallback.
- Translate: `--todo` lists only new / changed movies; `--merge` rejects unknown IDs and empty
  titles and never overwrites `reviewed` rows; transform emits `@en` / `@vi` labels and the
  untagged fallback.
- Validation: a deliberately broken graph fails the SHACL shapes.
- Growth: build A, then A+B → every triple about A's resources is unchanged.
- Smoke: full build on the real `data/` passes validation.

## 13. Open items

- **Licence:** IMDb data is under IMDb's non-commercial terms. The declared `dcterms:license`
  must be confirmed with the instructor; set in `config.py`.
- **Wikidata coverage** is only known after the first linking run; recorded in the link report.
