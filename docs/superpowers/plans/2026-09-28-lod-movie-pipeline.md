# LOD Movie Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the IMDb crawl in `data/` into a validated 5★ Linked Open Data dataset in `dist/` (ontology, 4★ instance data, 5★ link layer, VoID), with English/Vietnamese movie titles.

**Architecture:** A small Python package `pipeline/` with one module per stage: `load` (CSV → dataclasses) → `transform` (→ RDF data graph) → `link` (Wikidata/DBpedia link graph from a committed link store) → `void` (dataset description) → `validate` (SHACL + referential checks) → `build` (CLI, atomic write to `dist/`). `translate` is a separate no-network CLI that produces a worklist for Claude Code and merges the translated titles.

**Tech Stack:** Python 3.14, rdflib 7.6, pyshacl 0.40, requests, pytest.

**Spec:** `docs/superpowers/specs/2026-09-28-lod-movie-pipeline-design.md`

## Global Constraints

- Base URI: `https://lod-movie.felix-nguyen.io.vn/`; ontology namespace `https://lod-movie.felix-nguyen.io.vn/ontology#` (prefix `mo:`).
- Resource URIs: `/resource/movie/<tconst>`, `/resource/person/<nconst>`, `/resource/genre/<slug>`, `/resource/profession/<slug>`, `/resource/credit/<tconst>-<ordering>`, schemes `/resource/scheme/genres` and `/resource/scheme/professions`, dataset `/dataset`.
- Slug rule: lowercase; any run of non-alphanumeric characters → `-`; trim `-`.
- URIs derive only from IMDb IDs or slugs — never from row order.
- No blank nodes in data or links graphs.
- Empty source values produce no triple.
- Years, runtime, votes, billing order: `xsd:integer`; rating: `xsd:decimal`.
- Movie `rdfs:label` / `schema:name`: one `@en` and one `@vi` from `translations/movie_titles.csv`; untagged fallback plus warning if missing. Person names untagged.
- `owl:sameAs` only to `http://www.wikidata.org/entity/Q…` and `http://dbpedia.org/resource/…`; SKOS concepts use `skos:exactMatch` / `skos:closeMatch`.
- CSV input read with `encoding="utf-8-sig"`; files we write are UTF-8 without BOM, `\n` line endings.
- Wikidata: batches ≤ 200 IDs, ~1 s pause, retry on 429/5xx honouring `Retry-After`, descriptive User-Agent (no personal email).
- Bad-row threshold: build fails if more than 1% of rows are malformed.
- `dist/` is replaced only after validation passes.
- Tests never touch the network.

## Review Focus

- Titles containing commas, quotes and Unicode (Vietnamese diacritics, CJK original titles) must survive the CSV round-trip and RDF unchanged → test in Task 4 (`test_save_load_roundtrip_preserves_unicode_and_quotes`) and Task 5 (`test_unicode_original_title_preserved`).
- Wikipedia titles with `?`, `#`, `%`, quotes, parentheses or non-ASCII must become valid DBpedia IRIs that serialize to N-Triples and parse back → Task 6 (`test_dbpedia_iri_special_characters_roundtrip`).
- Rebuilding with unchanged inputs must produce byte-identical `data.nt` / `links.nt` so git diffs show only real changes → Task 10 (`test_rebuild_is_deterministic`).
- Wikidata failing mid-run must keep and save the batches that succeeded, so a rerun continues where it stopped → Task 6 (`test_resolve_keeps_successful_batches_on_failure`).
- A person with no IMDb name record (`name_record_missing = True`, empty name) must not break the build; the ID is used as the name with a warning → Task 2 (`test_missing_name_record_uses_id`).

---

## File Structure

| File | Responsibility |
|---|---|
| `pipeline/config.py` | Base URI, namespaces, paths, dataset metadata, `bind_namespaces`, `utf8_stdout` |
| `pipeline/uris.py` | Slug rule and URI minting for every resource type |
| `pipeline/load.py` | Read crawl folders → `Crawl` of `Movie`/`Person`/`Credit` records; merge, dedupe, bad-row accounting |
| `pipeline/translate.py` | Title store (`TitleRow`, load/save), `--todo` worklist, validated `--merge` |
| `pipeline/transform.py` | `Crawl` + titles → data graph (4★) |
| `pipeline/link.py` | Wikidata client, link store, `resolve_links`, mappings, `build_link_graph` (5★) |
| `pipeline/void.py` | VoID/DCAT dataset description with computed statistics |
| `pipeline/validate.py` | pyshacl run + referential/blank-node checks → `ValidationResult` |
| `pipeline/build.py` | CLI; orchestrates stages; atomic write of `dist/` |
| `ontology/movie.ttl` | Hand-written OWL ontology |
| `shapes/movie-shapes.ttl` | SHACL shapes |
| `mappings/genres.csv`, `mappings/professions.csv` | Hand-checked concept → Wikidata/DBpedia mappings |
| `translations/movie_titles.csv` | English/Vietnamese titles |
| `links/movies.csv`, `links/people.csv` | Link store (committed); `links/cache/` ignored |
| `tests/…` | pytest suite with fixtures under `tests/fixtures/` |

---

### Task 1: Project scaffold, config and URI minting

**Files:**
- Create: `.gitattributes`, `requirements.txt`, `pyproject.toml`, `pipeline/__init__.py`, `pipeline/config.py`, `pipeline/uris.py`, `tests/__init__.py`
- Modify: `.gitignore`
- Test: `tests/test_uris.py`

**Interfaces:**
- Produces: `config.BASE`, `RESOURCE`, `MO`, `SCHEMA`, `DBO`, `DBR`, `WD`, `DATASET_URI`, `SPARQL_ENDPOINT`, `DATA_DUMP`, `DATASET_TITLE`, `DATASET_VERSION`, `LICENSE`, `BAD_ROW_THRESHOLD`, `WIKIDATA_ENDPOINT`, `USER_AGENT`, `WIKIDATA_BATCH_SIZE`, `WIKIDATA_PAUSE_SECONDS`, path constants `ROOT`, `DEFAULT_INPUT`, `ONTOLOGY_PATH`, `SHAPES_PATH`, `MAPPINGS_DIR`, `LINKS_DIR`, `TITLES_PATH`, `TODO_PATH`, `DIST_DIR`; `bind_namespaces(graph) -> Graph`; `utf8_stdout() -> None`.
- Produces: `uris.slug(value: str) -> str`, `movie_uri(imdb_id) -> URIRef`, `person_uri(person_id)`, `genre_uri(name)`, `profession_uri(name)`, `credit_uri(imdb_id, ordering: int)`, `imdb_title_page(imdb_id)`, `imdb_name_page(person_id)`, constants `GENRE_SCHEME`, `PROFESSION_SCHEME`.

- [ ] **Step 1: Create a branch, virtualenv and project files**

```bash
cd d:/KHDL/semantic-web/code
git checkout -b pipeline
py -3.14 -m venv .venv
```

`.gitattributes`:
```
* text=auto eol=lf
*.gz binary
```

`requirements.txt`:
```
rdflib==7.6.0
pyshacl==0.40.1
requests>=2.32
pytest>=8
```

`pyproject.toml`:
```toml
[project]
name = "lod-movie-pipeline"
version = "1.0.0"
requires-python = ">=3.12"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

Append to `.gitignore`:
```
translations/todo.csv
dist.tmp/
```

`pipeline/__init__.py`:
```python
"""LOD Movie data pipeline: IMDb crawl -> 5-star Linked Open Data."""
```

`tests/__init__.py`: empty file.

```bash
.venv/Scripts/python -m pip install -r requirements.txt
```

- [ ] **Step 2: Write the failing test**

`tests/test_uris.py`:
```python
import pytest
from rdflib import URIRef

from pipeline.uris import (
    GENRE_SCHEME,
    credit_uri,
    genre_uri,
    imdb_name_page,
    imdb_title_page,
    movie_uri,
    person_uri,
    profession_uri,
    slug,
)

BASE = "https://lod-movie.felix-nguyen.io.vn/resource/"


@pytest.mark.parametrize(
    "value, expected",
    [
        ("Sci-Fi", "sci-fi"),
        ("casting_director", "casting-director"),
        ("Action", "action"),
        ("  Film--Noir  ", "film-noir"),
        ("music_department", "music-department"),
    ],
)
def test_slug(value, expected):
    assert slug(value) == expected


def test_slug_rejects_values_without_letters_or_digits():
    with pytest.raises(ValueError):
        slug("--")


def test_resource_uris():
    assert movie_uri("tt0081633") == URIRef(BASE + "movie/tt0081633")
    assert person_uri("nm0000025") == URIRef(BASE + "person/nm0000025")
    assert genre_uri("Sci-Fi") == URIRef(BASE + "genre/sci-fi")
    assert profession_uri("casting_director") == URIRef(BASE + "profession/casting-director")
    assert credit_uri("tt0081633", 3) == URIRef(BASE + "credit/tt0081633-3")
    assert GENRE_SCHEME == URIRef(BASE + "scheme/genres")


def test_imdb_pages():
    assert imdb_title_page("tt1") == URIRef("https://www.imdb.com/title/tt1/")
    assert imdb_name_page("nm1") == URIRef("https://www.imdb.com/name/nm1/")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/Scripts/python -m pytest tests/test_uris.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.uris'`

- [ ] **Step 4: Write the implementation**

`pipeline/config.py`:
```python
"""Project-wide constants: base URI, namespaces, file locations and dataset metadata."""

from __future__ import annotations

import sys
from pathlib import Path

from rdflib import Graph, Namespace
from rdflib.namespace import DCAT, DCTERMS, FOAF, OWL, SKOS, VOID, XSD

ROOT = Path(__file__).resolve().parent.parent

BASE = "https://lod-movie.felix-nguyen.io.vn/"
RESOURCE = BASE + "resource/"
MO = Namespace(BASE + "ontology#")
SCHEMA = Namespace("https://schema.org/")
DBO = Namespace("http://dbpedia.org/ontology/")
DBR = Namespace("http://dbpedia.org/resource/")
WD = Namespace("http://www.wikidata.org/entity/")

DATASET_URI = BASE + "dataset"
SPARQL_ENDPOINT = BASE + "sparql"
DATA_DUMP = BASE + "downloads/all.ttl.gz"
DATASET_TITLE = "LOD Movie"
DATASET_VERSION = "1.0.0"
# IMDb data is licensed for non-commercial use only; confirm the declared licence with the instructor.
LICENSE = "https://developer.imdb.com/non-commercial-datasets/"
BAD_ROW_THRESHOLD = 0.01

WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "lod-movie-capstone/1.0 (https://lod-movie.felix-nguyen.io.vn/; semantic-web student project)"
WIKIDATA_BATCH_SIZE = 200
WIKIDATA_PAUSE_SECONDS = 1.0

DEFAULT_INPUT = ROOT / "data"
ONTOLOGY_PATH = ROOT / "ontology" / "movie.ttl"
SHAPES_PATH = ROOT / "shapes" / "movie-shapes.ttl"
MAPPINGS_DIR = ROOT / "mappings"
LINKS_DIR = ROOT / "links"
TITLES_PATH = ROOT / "translations" / "movie_titles.csv"
TODO_PATH = ROOT / "translations" / "todo.csv"
DIST_DIR = ROOT / "dist"

_PREFIXES = {
    "mo": MO,
    "movie": Namespace(RESOURCE + "movie/"),
    "person": Namespace(RESOURCE + "person/"),
    "genre": Namespace(RESOURCE + "genre/"),
    "profession": Namespace(RESOURCE + "profession/"),
    "credit": Namespace(RESOURCE + "credit/"),
    "schema": SCHEMA,
    "dbo": DBO,
    "dbr": DBR,
    "wd": WD,
    "skos": SKOS,
    "foaf": FOAF,
    "owl": OWL,
    "dcterms": DCTERMS,
    "dcat": DCAT,
    "void": VOID,
    "xsd": XSD,
}


def bind_namespaces(graph: Graph) -> Graph:
    for prefix, namespace in _PREFIXES.items():
        graph.bind(prefix, namespace, override=True, replace=True)
    return graph


def utf8_stdout() -> None:
    """Print Vietnamese titles safely even when the Windows console uses a legacy code page."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
```

`pipeline/uris.py`:
```python
"""Stable URIs for every resource, derived only from IMDb IDs and slugs."""

from __future__ import annotations

import re

from rdflib import URIRef

from .config import RESOURCE

GENRE_SCHEME = URIRef(RESOURCE + "scheme/genres")
PROFESSION_SCHEME = URIRef(RESOURCE + "scheme/professions")


def slug(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not result:
        raise ValueError(f"cannot make a slug from {value!r}")
    return result


def movie_uri(imdb_id: str) -> URIRef:
    return URIRef(f"{RESOURCE}movie/{imdb_id}")


def person_uri(person_id: str) -> URIRef:
    return URIRef(f"{RESOURCE}person/{person_id}")


def genre_uri(name: str) -> URIRef:
    return URIRef(f"{RESOURCE}genre/{slug(name)}")


def profession_uri(name: str) -> URIRef:
    return URIRef(f"{RESOURCE}profession/{slug(name)}")


def credit_uri(imdb_id: str, ordering: int) -> URIRef:
    return URIRef(f"{RESOURCE}credit/{imdb_id}-{ordering}")


def imdb_title_page(imdb_id: str) -> URIRef:
    return URIRef(f"https://www.imdb.com/title/{imdb_id}/")


def imdb_name_page(person_id: str) -> URIRef:
    return URIRef(f"https://www.imdb.com/name/{person_id}/")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/Scripts/python -m pytest tests/test_uris.py -v`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add .gitattributes .gitignore requirements.txt pyproject.toml pipeline tests
git commit -m "feat: project scaffold, config and URI minting"
```

---

### Task 2: Crawl loader

**Files:**
- Create: `pipeline/load.py`, `tests/conftest.py`, `tests/fixtures/crawl_a/*`, `tests/fixtures/crawl_b/*`
- Test: `tests/test_load.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: dataclasses `Movie(imdb_id, primary_title, original_title, release_year, runtime_minutes, average_rating: Decimal|None, num_votes)`, `Person(person_id, name, birth_year, death_year, professions: tuple[str,...], known_for: tuple[str,...])`, `Credit(imdb_id, ordering: int, person_id, category, job: str|None, characters: tuple[str,...])`, `Crawl` with fields `movies: dict[str, Movie]`, `people: dict[str, Person]`, `credits: dict[tuple[str,int], Credit]`, `genres: dict[str, bool]`, `movie_genres: set[tuple[str,str]]`, `movie_people: set[tuple[str,str,str]]` (movie, person, role), `sampling: set[tuple[str,str]]`, `sources: list[dict]`, `warnings: list[str]`, `rows_read`, `rows_bad`, properties `bad_row_ratio: float`, `professions: set[str]`; function `load_crawl(dirs: Iterable[Path]) -> Crawl`; constant `ROLES`.
- Produces (tests): `tests/conftest.py` constant `FIXTURES: Path`, fixtures `crawl_a` and `crawl_ab`.

- [ ] **Step 1: Create fixture crawl A**

`tests/fixtures/crawl_a/movies.csv`:
```
imdb_id,primary_title,original_title,title_type,is_adult,start_year,end_year,runtime_minutes,average_rating,num_votes,genres,selected_for_categories,imdb_url
tt0000001,Alpha Movie,Alpha Film,movie,False,1990,,100,7.5,1000,"[""Action"", ""Comedy""]","[""Action""]",https://www.imdb.com/title/tt0000001/
tt0000002,Beta Movie,Beta Movie,movie,False,2001,,,6.0,2000,"[""Drama""]","[""Drama""]",https://www.imdb.com/title/tt0000002/
tt0000003,Gamma Movie,第一类型危险,movie,False,2010,,95,5.5,1500,"[""Sci-Fi""]","[""Sci-Fi""]",https://www.imdb.com/title/tt0000003/
```

`tests/fixtures/crawl_a/people.csv`:
```
person_id,primary_name,birth_year,death_year,primary_professions,known_for_title_ids,imdb_url,name_record_missing
nm0000001,Ann Actor,1960,,"[""actress"", ""producer""]","[""tt0000001"", ""tt9999999""]",https://www.imdb.com/name/nm0000001/,False
nm0000002,Bob Director,1950,2020,"[""director"", ""writer""]","[""tt0000002""]",https://www.imdb.com/name/nm0000002/,False
nm0000003,Cat Composer,,,"[""composer""]",[],https://www.imdb.com/name/nm0000003/,False
```

`tests/fixtures/crawl_a/genres.csv`:
```
genre,is_target_category
Action,True
Comedy,False
Drama,True
Sci-Fi,True
```

`tests/fixtures/crawl_a/movie_genres.csv`:
```
imdb_id,genre
tt0000001,Action
tt0000001,Comedy
tt0000002,Drama
tt0000003,Sci-Fi
```

`tests/fixtures/crawl_a/movie_people.csv`:
```
imdb_id,person_id,role,sources
tt0000001,nm0000001,actor,"[""title.principals""]"
tt0000001,nm0000002,director,"[""title.crew""]"
tt0000002,nm0000002,director,"[""title.crew"", ""title.principals""]"
tt0000002,nm0000002,writer,"[""title.crew""]"
tt0000003,nm0000001,actor,"[""title.principals""]"
```

`tests/fixtures/crawl_a/principal_credits.csv`:
```
imdb_id,ordering,person_id,category,job,characters
tt0000001,1,nm0000001,actress,,"[""Hero"", ""Villain""]"
tt0000001,2,nm0000002,director,,
tt0000001,3,nm0000003,composer,composer,
tt0000002,1,nm0000002,director,,
tt0000003,1,nm0000001,actress,,"[""Captain""]"
```

`tests/fixtures/crawl_a/sampling.csv`:
```
imdb_id,sample_category
tt0000001,Action
tt0000002,Drama
tt0000003,Sci-Fi
```

`tests/fixtures/crawl_a/manifest.json`:
```json
{
  "sources": [
    {"dataset": "title.basics", "url": "https://datasets.imdbws.com/title.basics.tsv.gz"},
    {"dataset": "name.basics", "url": "https://datasets.imdbws.com/name.basics.tsv.gz"}
  ]
}
```

- [ ] **Step 2: Create fixture crawl B (2 new movies, person nm0000001 overlaps with an identical row)**

`tests/fixtures/crawl_b/movies.csv`:
```
imdb_id,primary_title,original_title,title_type,is_adult,start_year,end_year,runtime_minutes,average_rating,num_votes,genres,selected_for_categories,imdb_url
tt0000004,Delta Movie,Delta Movie,movie,False,2015,,88,4.2,3000,"[""Horror""]","[""Horror""]",https://www.imdb.com/title/tt0000004/
tt0000005,Epsilon,Epsilon,movie,False,2020,,120,8.1,9000,"[""Comedy"", ""Romance""]","[""Romance""]",https://www.imdb.com/title/tt0000005/
```

`tests/fixtures/crawl_b/people.csv`:
```
person_id,primary_name,birth_year,death_year,primary_professions,known_for_title_ids,imdb_url,name_record_missing
nm0000001,Ann Actor,1960,,"[""actress"", ""producer""]","[""tt0000001"", ""tt9999999""]",https://www.imdb.com/name/nm0000001/,False
nm0000004,Dan Writer,1970,,"[""writer"", ""director""]","[""tt0000005""]",https://www.imdb.com/name/nm0000004/,False
```

`tests/fixtures/crawl_b/genres.csv`:
```
genre,is_target_category
Comedy,False
Horror,True
Romance,True
```

`tests/fixtures/crawl_b/movie_genres.csv`:
```
imdb_id,genre
tt0000004,Horror
tt0000005,Comedy
tt0000005,Romance
```

`tests/fixtures/crawl_b/movie_people.csv`:
```
imdb_id,person_id,role,sources
tt0000004,nm0000001,actor,"[""title.principals""]"
tt0000004,nm0000004,writer,"[""title.crew""]"
tt0000005,nm0000004,director,"[""title.crew""]"
```

`tests/fixtures/crawl_b/principal_credits.csv`:
```
imdb_id,ordering,person_id,category,job,characters
tt0000004,1,nm0000001,actress,,"[""Survivor""]"
tt0000004,2,nm0000004,writer,written by,
tt0000005,1,nm0000004,director,,
```

`tests/fixtures/crawl_b/sampling.csv`:
```
imdb_id,sample_category
tt0000004,Horror
tt0000005,Romance
```

`tests/fixtures/crawl_b/manifest.json`:
```json
{"sources": [{"dataset": "title.basics", "url": "https://datasets.imdbws.com/title.basics.tsv.gz"}]}
```

- [ ] **Step 3: Write the failing tests**

`tests/conftest.py`:
```python
from pathlib import Path

import pytest

from pipeline.load import load_crawl

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def crawl_a():
    return load_crawl([FIXTURES / "crawl_a"])


@pytest.fixture
def crawl_ab():
    return load_crawl([FIXTURES / "crawl_a", FIXTURES / "crawl_b"])
```

`tests/test_load.py`:
```python
import shutil
from decimal import Decimal

from pipeline.load import Credit, Movie, load_crawl
from tests.conftest import FIXTURES


def test_movies_are_typed(crawl_a):
    assert crawl_a.movies["tt0000001"] == Movie(
        imdb_id="tt0000001",
        primary_title="Alpha Movie",
        original_title="Alpha Film",
        release_year=1990,
        runtime_minutes=100,
        average_rating=Decimal("7.5"),
        num_votes=1000,
    )
    assert crawl_a.movies["tt0000002"].runtime_minutes is None


def test_people_lists_and_empty_years(crawl_a):
    ann = crawl_a.people["nm0000001"]
    assert ann.professions == ("actress", "producer")
    assert ann.known_for == ("tt0000001", "tt9999999")
    cat = crawl_a.people["nm0000003"]
    assert cat.birth_year is None and cat.known_for == ()


def test_credits_relations_and_genres(crawl_a):
    assert crawl_a.credits[("tt0000001", 1)] == Credit(
        imdb_id="tt0000001", ordering=1, person_id="nm0000001",
        category="actress", job=None, characters=("Hero", "Villain"),
    )
    assert ("tt0000002", "nm0000002", "writer") in crawl_a.movie_people
    assert ("tt0000001", "Comedy") in crawl_a.movie_genres
    assert crawl_a.genres == {"Action": True, "Comedy": False, "Drama": True, "Sci-Fi": True}
    assert ("tt0000003", "Sci-Fi") in crawl_a.sampling
    assert crawl_a.professions == {"actress", "producer", "director", "writer", "composer"}
    assert [s["url"] for s in crawl_a.sources] == [
        "https://datasets.imdbws.com/title.basics.tsv.gz",
        "https://datasets.imdbws.com/name.basics.tsv.gz",
    ]


def test_clean_fixture_has_no_warnings(crawl_a):
    assert crawl_a.warnings == []
    assert crawl_a.rows_bad == 0
    assert crawl_a.rows_read == 27


def test_bom_is_ignored(tmp_path):
    folder = tmp_path / "crawl"
    shutil.copytree(FIXTURES / "crawl_a", folder)
    text = (folder / "genres.csv").read_text(encoding="utf-8")
    (folder / "genres.csv").write_text(text, encoding="utf-8-sig")
    assert load_crawl([folder]).genres["Action"] is True


def test_merge_two_crawls_dedupes(crawl_ab):
    assert sorted(crawl_ab.movies) == [f"tt000000{i}" for i in range(1, 6)]
    assert sorted(crawl_ab.people) == ["nm0000001", "nm0000002", "nm0000003", "nm0000004"]
    assert crawl_ab.genres["Horror"] is True
    assert len(crawl_ab.sources) == 2
    assert crawl_ab.warnings == []


def test_conflicting_values_warn_and_later_input_wins(tmp_path):
    b = tmp_path / "b"
    shutil.copytree(FIXTURES / "crawl_b", b)
    people = (b / "people.csv").read_text(encoding="utf-8").replace("Ann Actor,1960", "Ann Actor,1961")
    (b / "people.csv").write_text(people, encoding="utf-8")
    crawl = load_crawl([FIXTURES / "crawl_a", b])
    assert crawl.people["nm0000001"].birth_year == 1961
    assert any("nm0000001" in w and "later input wins" in w for w in crawl.warnings)


def test_malformed_rows_are_skipped_and_counted(tmp_path):
    folder = tmp_path / "crawl"
    shutil.copytree(FIXTURES / "crawl_a", folder)
    with (folder / "movies.csv").open("a", encoding="utf-8") as f:
        f.write("tt0000009,Bad Year,Bad,movie,False,nineteen,,90,5.0,10,[],[],x\n")
        f.write("xx123,Bad Id,Bad,movie,False,1990,,90,5.0,10,[],[],x\n")
    with (folder / "movie_people.csv").open("a", encoding="utf-8") as f:
        f.write('tt0000001,nm0000003,composer,"[]"\n')
    crawl = load_crawl([folder])
    assert "tt0000009" not in crawl.movies
    assert crawl.rows_bad == 3
    assert crawl.rows_read == 30
    assert any("movies.csv:5" in w and "start_year" in w for w in crawl.warnings)
    assert any("movie_people.csv" in w and "role" in w for w in crawl.warnings)


def test_missing_name_record_uses_id(tmp_path):
    folder = tmp_path / "crawl"
    shutil.copytree(FIXTURES / "crawl_a", folder)
    with (folder / "people.csv").open("a", encoding="utf-8") as f:
        f.write("nm0000009,,,,[],[],https://www.imdb.com/name/nm0000009/,True\n")
    crawl = load_crawl([folder])
    assert crawl.people["nm0000009"].name == "nm0000009"
    assert any("nm0000009" in w and "no name record" in w for w in crawl.warnings)
    assert crawl.rows_bad == 0


def test_missing_file_is_a_warning(tmp_path):
    folder = tmp_path / "crawl"
    shutil.copytree(FIXTURES / "crawl_a", folder)
    (folder / "sampling.csv").unlink()
    crawl = load_crawl([folder])
    assert crawl.sampling == set()
    assert any("sampling.csv" in w and "not found" in w for w in crawl.warnings)
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_load.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.load'`

- [ ] **Step 5: Write the implementation**

`pipeline/load.py`:
```python
"""Load one or more IMDb crawl folders into typed, de-duplicated records."""

from __future__ import annotations

import csv
import json
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROLES = ("actor", "director", "writer")


class RowError(ValueError):
    """A CSV row that cannot be used."""


@dataclass(frozen=True)
class Movie:
    imdb_id: str
    primary_title: str
    original_title: str | None
    release_year: int | None
    runtime_minutes: int | None
    average_rating: Decimal | None
    num_votes: int | None


@dataclass(frozen=True)
class Person:
    person_id: str
    name: str
    birth_year: int | None
    death_year: int | None
    professions: tuple[str, ...]
    known_for: tuple[str, ...]


@dataclass(frozen=True)
class Credit:
    imdb_id: str
    ordering: int
    person_id: str
    category: str
    job: str | None
    characters: tuple[str, ...]


@dataclass
class Crawl:
    movies: dict[str, Movie] = field(default_factory=dict)
    people: dict[str, Person] = field(default_factory=dict)
    credits: dict[tuple[str, int], Credit] = field(default_factory=dict)
    genres: dict[str, bool] = field(default_factory=dict)  # genre name -> is a sampled target genre
    movie_genres: set[tuple[str, str]] = field(default_factory=set)
    movie_people: set[tuple[str, str, str]] = field(default_factory=set)  # (movie, person, role)
    sampling: set[tuple[str, str]] = field(default_factory=set)
    sources: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    rows_read: int = 0
    rows_bad: int = 0

    @property
    def bad_row_ratio(self) -> float:
        return self.rows_bad / self.rows_read if self.rows_read else 0.0

    @property
    def professions(self) -> set[str]:
        values = {p for person in self.people.values() for p in person.professions}
        return values | {credit.category for credit in self.credits.values()}


def load_crawl(dirs: Iterable[Path]) -> Crawl:
    """Read every crawl folder in order; later folders win on conflicting values."""
    crawl = Crawl()
    for folder in dirs:
        _load_dir(Path(folder), crawl)
    for _, genre in sorted(crawl.movie_genres | crawl.sampling):
        crawl.genres.setdefault(genre, False)
    return crawl


def _load_dir(folder: Path, crawl: Crawl) -> None:
    _load_manifest(folder / "manifest.json", crawl)

    def movie(row: dict) -> None:
        record = Movie(
            imdb_id=_imdb_id(row, "imdb_id", "tt"),
            primary_title=_required(row, "primary_title"),
            original_title=_text(row, "original_title"),
            release_year=_int(row, "start_year"),
            runtime_minutes=_int(row, "runtime_minutes"),
            average_rating=_decimal(row, "average_rating"),
            num_votes=_int(row, "num_votes"),
        )
        _merge(crawl, crawl.movies, record.imdb_id, record, "movie")

    def person(row: dict) -> None:
        person_id = _imdb_id(row, "person_id", "nm")
        name = _text(row, "primary_name")
        if name is None:
            if not _bool(row, "name_record_missing"):
                raise RowError("missing primary_name")
            crawl.warnings.append(f"person {person_id}: IMDb has no name record, using the ID as name")
            name = person_id
        record = Person(
            person_id=person_id,
            name=name,
            birth_year=_int(row, "birth_year"),
            death_year=_int(row, "death_year"),
            professions=_json_list(row, "primary_professions"),
            known_for=_json_list(row, "known_for_title_ids"),
        )
        _merge(crawl, crawl.people, person_id, record, "person")

    def genre(row: dict) -> None:
        name = _required(row, "genre")
        crawl.genres[name] = crawl.genres.get(name, False) or _bool(row, "is_target_category")

    def movie_genre(row: dict) -> None:
        crawl.movie_genres.add((_imdb_id(row, "imdb_id", "tt"), _required(row, "genre")))

    def movie_person(row: dict) -> None:
        role = _required(row, "role")
        if role not in ROLES:
            raise RowError(f"unknown role {role!r}")
        crawl.movie_people.add((_imdb_id(row, "imdb_id", "tt"), _imdb_id(row, "person_id", "nm"), role))

    def credit(row: dict) -> None:
        ordering = _int(row, "ordering")
        if ordering is None:
            raise RowError("missing ordering")
        record = Credit(
            imdb_id=_imdb_id(row, "imdb_id", "tt"),
            ordering=ordering,
            person_id=_imdb_id(row, "person_id", "nm"),
            category=_required(row, "category"),
            job=_text(row, "job"),
            characters=_json_list(row, "characters"),
        )
        _merge(crawl, crawl.credits, (record.imdb_id, record.ordering), record, "credit")

    def sample(row: dict) -> None:
        crawl.sampling.add((_imdb_id(row, "imdb_id", "tt"), _required(row, "sample_category")))

    for filename, handler in (
        ("movies.csv", movie),
        ("people.csv", person),
        ("genres.csv", genre),
        ("movie_genres.csv", movie_genre),
        ("movie_people.csv", movie_person),
        ("principal_credits.csv", credit),
        ("sampling.csv", sample),
    ):
        _each_row(folder / filename, crawl, handler)


def _load_manifest(path: Path, crawl: Crawl) -> None:
    if not path.exists():
        crawl.warnings.append(f"{path}: not found, skipped")
        return
    known = {source["url"] for source in crawl.sources}
    for source in json.loads(path.read_text(encoding="utf-8-sig")).get("sources", []):
        url = source.get("url")
        if url and url not in known:
            crawl.sources.append(source)
            known.add(url)


def _each_row(path: Path, crawl: Crawl, handle: Callable[[dict], None]) -> None:
    if not path.exists():
        crawl.warnings.append(f"{path}: not found, skipped")
        return
    with path.open(encoding="utf-8-sig", newline="") as f:
        for line, row in enumerate(csv.DictReader(f), start=2):
            crawl.rows_read += 1
            try:
                handle(row)
            except RowError as exc:
                crawl.rows_bad += 1
                crawl.warnings.append(f"{path.name}:{line}: skipped ({exc})")


def _merge(crawl: Crawl, table: dict, key, value, what: str) -> None:
    old = table.get(key)
    if old is not None and old != value:
        crawl.warnings.append(f"{what} {key}: conflicting values across inputs, later input wins")
    table[key] = value


def _text(row: dict, key: str) -> str | None:
    value = (row.get(key) or "").strip()
    return value or None


def _required(row: dict, key: str) -> str:
    value = _text(row, key)
    if value is None:
        raise RowError(f"missing {key}")
    return value


def _imdb_id(row: dict, key: str, prefix: str) -> str:
    value = _required(row, key)
    if not re.fullmatch(prefix + r"\d+", value):
        raise RowError(f"bad {key} {value!r}")
    return value


def _int(row: dict, key: str) -> int | None:
    value = _text(row, key)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        raise RowError(f"bad integer {key}={value!r}") from None


def _decimal(row: dict, key: str) -> Decimal | None:
    value = _text(row, key)
    if value is None:
        return None
    try:
        return Decimal(value)
    except InvalidOperation:
        raise RowError(f"bad decimal {key}={value!r}") from None


def _json_list(row: dict, key: str) -> tuple[str, ...]:
    value = _text(row, key)
    if value is None:
        return ()
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        raise RowError(f"bad JSON list {key}={value!r}") from None
    if not isinstance(data, list):
        raise RowError(f"{key} is not a JSON list")
    return tuple(str(item) for item in data)


def _bool(row: dict, key: str) -> bool:
    value = (_text(row, key) or "false").lower()
    if value in ("true", "1"):
        return True
    if value in ("false", "0"):
        return False
    raise RowError(f"bad boolean {key}={value!r}")
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_load.py -v`
Expected: PASS (10 tests)

- [ ] **Step 7: Commit**

```bash
git add pipeline/load.py tests/conftest.py tests/test_load.py tests/fixtures
git commit -m "feat: crawl loader with multi-input merge and bad-row accounting"
```

---

### Task 3: Ontology

**Files:**
- Create: `ontology/movie.ttl`
- Test: `tests/test_ontology.py`

**Interfaces:**
- Produces: OWL terms used by later tasks — classes `mo:Movie`, `mo:Person`, `mo:Genre`, `mo:Profession`, `mo:Credit`; object properties `mo:hasGenre`, `mo:directedBy`, `mo:directorOf`, `mo:hasActor`, `mo:actedIn`, `mo:writtenBy`, `mo:writerOf`, `mo:hasCredit`, `mo:creditFor`, `mo:creditedPerson`, `mo:creditRole`, `mo:primaryProfession`, `mo:knownFor`, `mo:sampledForGenre`; datatype properties `mo:primaryTitle`, `mo:originalTitle`, `mo:releaseYear`, `mo:runtimeMinutes`, `mo:averageRating`, `mo:numVotes`, `mo:imdbId`, `mo:birthYear`, `mo:deathYear`, `mo:characterName`, `mo:billingOrder`, `mo:job`, `mo:isTargetGenre`.

- [ ] **Step 1: Write the failing test**

`tests/test_ontology.py`:
```python
import pytest
from rdflib import Graph, URIRef
from rdflib.namespace import OWL, RDF, RDFS

from pipeline.config import DBO, MO, ONTOLOGY_PATH, SCHEMA

ONTOLOGY_URI = URIRef("https://lod-movie.felix-nguyen.io.vn/ontology")
KINDS = (OWL.Class, OWL.ObjectProperty, OWL.DatatypeProperty)


@pytest.fixture(scope="module")
def onto():
    return Graph().parse(ONTOLOGY_PATH)


def terms(onto, kinds=KINDS):
    return sorted({s for kind in kinds for s in onto.subjects(RDF.type, kind) if str(s).startswith(str(MO))})


def test_ontology_header(onto):
    assert (ONTOLOGY_URI, RDF.type, OWL.Ontology) in onto
    assert onto.value(ONTOLOGY_URI, OWL.versionInfo) is not None


def test_expected_classes(onto):
    names = {str(t).split("#")[1] for t in terms(onto, (OWL.Class,))}
    assert names == {"Movie", "Person", "Genre", "Profession", "Credit"}


def test_every_term_has_label_and_comment(onto):
    for term in terms(onto):
        assert onto.value(term, RDFS.label) is not None, term
        assert onto.value(term, RDFS.comment) is not None, term


def test_every_property_has_domain_and_range(onto):
    for prop in terms(onto, (OWL.ObjectProperty, OWL.DatatypeProperty)):
        assert onto.value(prop, RDFS.domain) is not None, prop
        assert onto.value(prop, RDFS.range) is not None, prop


def test_alignment_to_standard_vocabularies(onto):
    assert (MO.Movie, RDFS.subClassOf, SCHEMA.Movie) in onto
    assert (MO.Movie, OWL.equivalentClass, DBO.Film) in onto
    assert (MO.directedBy, RDFS.subPropertyOf, SCHEMA.director) in onto
    assert (MO.hasActor, OWL.inverseOf, MO.actedIn) in onto
    assert (MO.creditedPerson, RDF.type, OWL.FunctionalProperty) in onto
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python -m pytest tests/test_ontology.py -v`
Expected: FAIL with `FileNotFoundError` for `ontology/movie.ttl`

- [ ] **Step 3: Write the ontology**

`ontology/movie.ttl`:
```turtle
@prefix mo:      <https://lod-movie.felix-nguyen.io.vn/ontology#> .
@prefix owl:     <http://www.w3.org/2002/07/owl#> .
@prefix rdf:     <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix skos:    <http://www.w3.org/2004/02/skos/core#> .
@prefix schema:  <https://schema.org/> .
@prefix foaf:    <http://xmlns.com/foaf/0.1/> .
@prefix dbo:     <http://dbpedia.org/ontology/> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<https://lod-movie.felix-nguyen.io.vn/ontology>
    a owl:Ontology ;
    dcterms:title "LOD Movie Ontology"@en ;
    dcterms:description "Vocabulary for a Linked Open Data dataset of IMDb movies, the people who made them, their genres and their principal credits. Reuses schema.org, the DBpedia ontology, FOAF and SKOS."@en ;
    dcterms:creator "Felix Nguyen" ;
    dcterms:created "2026-09-28"^^xsd:date ;
    owl:versionInfo "1.0.0" .

#################################################################
# Classes
#################################################################

mo:Movie a owl:Class ;
    rdfs:label "Movie"@en ;
    rdfs:comment "A feature film listed on IMDb with title type 'movie'."@en ;
    rdfs:subClassOf schema:Movie ;
    owl:equivalentClass dbo:Film .

mo:Person a owl:Class ;
    rdfs:label "Person"@en ;
    rdfs:comment "A person credited on at least one movie in the dataset, as cast or crew."@en ;
    rdfs:subClassOf schema:Person , foaf:Person .

mo:Genre a owl:Class ;
    rdfs:label "Genre"@en ;
    rdfs:comment "A movie genre, modelled as a SKOS concept in the genre scheme. Genres are individuals, not subclasses of Movie."@en ;
    rdfs:subClassOf skos:Concept .

mo:Profession a owl:Class ;
    rdfs:label "Profession"@en ;
    rdfs:comment "A job or role in film-making (for example actor, director, cinematographer), modelled as a SKOS concept. Used both for a person's primary professions and for the role of a credit."@en ;
    rdfs:subClassOf skos:Concept .

mo:Credit a owl:Class ;
    rdfs:label "Credit"@en ;
    rdfs:comment "One principal credit: a person working on a movie in a given role, with a billing order and, for cast, the characters played. An n-ary relation node that links a Movie, a Person and a Profession."@en .

#################################################################
# Object properties
#################################################################

mo:hasGenre a owl:ObjectProperty ;
    rdfs:label "has genre"@en ;
    rdfs:comment "A genre IMDb assigns to the movie."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range mo:Genre ;
    rdfs:subPropertyOf schema:genre .

mo:sampledForGenre a owl:ObjectProperty ;
    rdfs:label "sampled for genre"@en ;
    rdfs:comment "Provenance: the target genre whose random sample selected this movie for the dataset."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range mo:Genre .

mo:directedBy a owl:ObjectProperty ;
    rdfs:label "directed by"@en ;
    rdfs:comment "A director of the movie."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range mo:Person ;
    rdfs:subPropertyOf schema:director ;
    owl:inverseOf mo:directorOf .

mo:directorOf a owl:ObjectProperty ;
    rdfs:label "director of"@en ;
    rdfs:comment "A movie this person directed. Inverse of directed by; not materialized in the data."@en ;
    rdfs:domain mo:Person ;
    rdfs:range mo:Movie .

mo:hasActor a owl:ObjectProperty ;
    rdfs:label "has actor"@en ;
    rdfs:comment "A principal cast member of the movie."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range mo:Person ;
    rdfs:subPropertyOf schema:actor ;
    owl:inverseOf mo:actedIn .

mo:actedIn a owl:ObjectProperty ;
    rdfs:label "acted in"@en ;
    rdfs:comment "A movie this person acted in. Inverse of has actor; not materialized in the data."@en ;
    rdfs:domain mo:Person ;
    rdfs:range mo:Movie .

mo:writtenBy a owl:ObjectProperty ;
    rdfs:label "written by"@en ;
    rdfs:comment "A writer of the movie."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range mo:Person ;
    rdfs:subPropertyOf schema:author ;
    owl:inverseOf mo:writerOf .

mo:writerOf a owl:ObjectProperty ;
    rdfs:label "writer of"@en ;
    rdfs:comment "A movie this person wrote. Inverse of written by; not materialized in the data."@en ;
    rdfs:domain mo:Person ;
    rdfs:range mo:Movie .

mo:hasCredit a owl:ObjectProperty ;
    rdfs:label "has credit"@en ;
    rdfs:comment "A principal credit of the movie."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range mo:Credit ;
    owl:inverseOf mo:creditFor .

mo:creditFor a owl:ObjectProperty , owl:FunctionalProperty ;
    rdfs:label "credit for"@en ;
    rdfs:comment "The movie a credit belongs to. Inverse of has credit; not materialized in the data."@en ;
    rdfs:domain mo:Credit ;
    rdfs:range mo:Movie .

mo:creditedPerson a owl:ObjectProperty , owl:FunctionalProperty ;
    rdfs:label "credited person"@en ;
    rdfs:comment "The person named in the credit."@en ;
    rdfs:domain mo:Credit ;
    rdfs:range mo:Person .

mo:creditRole a owl:ObjectProperty , owl:FunctionalProperty ;
    rdfs:label "credit role"@en ;
    rdfs:comment "The role of the person in this credit, such as actress or cinematographer."@en ;
    rdfs:domain mo:Credit ;
    rdfs:range mo:Profession .

mo:primaryProfession a owl:ObjectProperty ;
    rdfs:label "primary profession"@en ;
    rdfs:comment "One of the person's main professions according to IMDb."@en ;
    rdfs:domain mo:Person ;
    rdfs:range mo:Profession .

mo:knownFor a owl:ObjectProperty ;
    rdfs:label "known for"@en ;
    rdfs:comment "A movie the person is best known for. Only stated when that movie is part of this dataset."@en ;
    rdfs:domain mo:Person ;
    rdfs:range mo:Movie .

#################################################################
# Datatype properties
#################################################################

mo:primaryTitle a owl:DatatypeProperty ;
    rdfs:label "primary title"@en ;
    rdfs:comment "The IMDb primary title exactly as crawled; its language is not recorded. Language-tagged English and Vietnamese titles are given with rdfs:label and schema:name."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range xsd:string .

mo:originalTitle a owl:DatatypeProperty ;
    rdfs:label "original title"@en ;
    rdfs:comment "The title in the original language of the movie."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range xsd:string .

mo:releaseYear a owl:DatatypeProperty ;
    rdfs:label "release year"@en ;
    rdfs:comment "Calendar year of first release, as an integer to keep SPARQL filters simple."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range xsd:integer .

mo:runtimeMinutes a owl:DatatypeProperty ;
    rdfs:label "runtime (minutes)"@en ;
    rdfs:comment "Running time of the movie in minutes."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range xsd:integer .

mo:averageRating a owl:DatatypeProperty ;
    rdfs:label "average rating"@en ;
    rdfs:comment "Weighted average IMDb user rating from 1 to 10."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range xsd:decimal .

mo:numVotes a owl:DatatypeProperty ;
    rdfs:label "number of votes"@en ;
    rdfs:comment "Number of IMDb user votes behind the average rating."@en ;
    rdfs:domain mo:Movie ;
    rdfs:range xsd:integer .

mo:imdbId a owl:DatatypeProperty ;
    rdfs:label "IMDb ID"@en ;
    rdfs:comment "The IMDb identifier: tconst (tt...) for movies, nconst (nm...) for people. Also Wikidata property P345."@en ;
    rdfs:domain [ a owl:Class ; owl:unionOf ( mo:Movie mo:Person ) ] ;
    rdfs:range xsd:string .

mo:birthYear a owl:DatatypeProperty ;
    rdfs:label "birth year"@en ;
    rdfs:comment "Calendar year the person was born."@en ;
    rdfs:domain mo:Person ;
    rdfs:range xsd:integer .

mo:deathYear a owl:DatatypeProperty ;
    rdfs:label "death year"@en ;
    rdfs:comment "Calendar year the person died, if applicable."@en ;
    rdfs:domain mo:Person ;
    rdfs:range xsd:integer .

mo:characterName a owl:DatatypeProperty ;
    rdfs:label "character name"@en ;
    rdfs:comment "A character played in this credit; one value per character."@en ;
    rdfs:domain mo:Credit ;
    rdfs:range xsd:string .

mo:billingOrder a owl:DatatypeProperty ;
    rdfs:label "billing order"@en ;
    rdfs:comment "Position of the credit in IMDb's principal credits list, starting at 1."@en ;
    rdfs:domain mo:Credit ;
    rdfs:range xsd:integer .

mo:job a owl:DatatypeProperty ;
    rdfs:label "job"@en ;
    rdfs:comment "Free-text job description from IMDb, such as 'director of photography'."@en ;
    rdfs:domain mo:Credit ;
    rdfs:range xsd:string .

mo:isTargetGenre a owl:DatatypeProperty ;
    rdfs:label "is target genre"@en ;
    rdfs:comment "True for the genres the dataset was sampled from (Action, Comedy, Drama, Horror, Romance, Sci-Fi)."@en ;
    rdfs:domain mo:Genre ;
    rdfs:range xsd:boolean .
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python -m pytest tests/test_ontology.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add ontology tests/test_ontology.py
git commit -m "feat: OWL ontology aligned to schema.org, DBpedia, FOAF and SKOS"
```

---

### Task 4: Translation store, worklist and merge

**Files:**
- Create: `pipeline/translate.py`, `tests/fixtures/movie_titles.csv`
- Test: `tests/test_translate.py`

**Interfaces:**
- Consumes: `load.Crawl`, `load.Movie`, `load.load_crawl`, `config.DEFAULT_INPUT`, `config.TITLES_PATH`, `config.TODO_PATH`, `config.utf8_stdout`.
- Produces: `TitleRow(imdb_id, primary_title, title_en, title_vi, source, translated_at)` (frozen dataclass); `load_titles(path: Path) -> dict[str, TitleRow]`; `save_titles(path: Path, rows: dict[str, TitleRow]) -> None`; `needs_translation(crawl, titles) -> list[Movie]`; `write_todo(path, crawl, movies) -> None`; `merge_todo(path, titles, crawl, today: str) -> tuple[int, list[str]]` (mutates `titles`); `main(argv=None) -> int`.

- [ ] **Step 1: Create the titles fixture**

`tests/fixtures/movie_titles.csv`:
```
imdb_id,primary_title,title_en,title_vi,source,translated_at
tt0000001,Alpha Movie,Alpha Movie,Phim Alpha,machine,2026-09-28
tt0000002,Beta Movie,Beta Movie,Phim Beta,reviewed,2026-09-28
```

- [ ] **Step 2: Write the failing tests**

`tests/test_translate.py`:
```python
import csv
import shutil

import pytest

from pipeline.translate import (
    TitleRow,
    load_titles,
    main,
    merge_todo,
    needs_translation,
    save_titles,
    write_todo,
)
from tests.conftest import FIXTURES


@pytest.fixture
def titles():
    return load_titles(FIXTURES / "movie_titles.csv")


def write_csv(path, header, rows):
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)


TODO_HEADER = ["imdb_id", "primary_title", "original_title", "year", "genres", "title_en", "title_vi"]


def test_load_titles(titles):
    assert titles["tt0000002"] == TitleRow(
        "tt0000002", "Beta Movie", "Beta Movie", "Phim Beta", "reviewed", "2026-09-28"
    )


def test_load_titles_missing_file_is_empty(tmp_path):
    assert load_titles(tmp_path / "none.csv") == {}


def test_load_titles_rejects_unknown_source(tmp_path):
    path = tmp_path / "t.csv"
    write_csv(path, ["imdb_id", "primary_title", "title_en", "title_vi", "source", "translated_at"],
              [["tt1", "A", "A", "B", "robot", "2026-01-01"]])
    with pytest.raises(ValueError, match="source"):
        load_titles(path)


def test_save_load_roundtrip_preserves_unicode_and_quotes(tmp_path):
    rows = {
        "tt9": TitleRow("tt9", 'Time, "Bandits"', 'Time, "Bandits"', 'Kẻ Cắp, "Thời Gian"', "machine", "2026-09-28"),
        "tt1": TitleRow("tt1", "第一类型危险", "Dangerous Encounters", "Hiểm Họa Loại Một", "reviewed", "2026-09-28"),
    }
    path = tmp_path / "titles.csv"
    save_titles(path, rows)
    assert load_titles(path) == rows
    raw = path.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf") and b"\r\n" not in raw
    assert raw.decode("utf-8").splitlines()[1].startswith("tt1,")  # sorted by ID


def test_needs_translation(crawl_a, titles):
    assert [m.imdb_id for m in needs_translation(crawl_a, titles)] == ["tt0000003"]


def test_changed_title_needs_translation_unless_reviewed(crawl_a, titles):
    titles["tt0000001"] = TitleRow("tt0000001", "Old Alpha", "Old", "Cũ", "machine", "2026-01-01")
    titles["tt0000002"] = TitleRow("tt0000002", "Old Beta", "Old", "Cũ", "reviewed", "2026-01-01")
    assert [m.imdb_id for m in needs_translation(crawl_a, titles)] == ["tt0000001", "tt0000003"]


def test_write_todo(tmp_path, crawl_a):
    path = tmp_path / "todo.csv"
    write_todo(path, crawl_a, [crawl_a.movies["tt0000001"], crawl_a.movies["tt0000003"]])
    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert list(rows[0]) == TODO_HEADER
    assert rows[0]["genres"] == "Action, Comedy"
    assert rows[1] == {
        "imdb_id": "tt0000003", "primary_title": "Gamma Movie", "original_title": "第一类型危险",
        "year": "2010", "genres": "Sci-Fi", "title_en": "", "title_vi": "",
    }


def test_merge_valid_rows(tmp_path, crawl_a, titles):
    path = tmp_path / "todo.csv"
    write_csv(path, TODO_HEADER, [["tt0000003", "Gamma Movie", "", "2010", "Sci-Fi", "Gamma Movie", "Phim Gamma"]])
    merged, errors = merge_todo(path, titles, crawl_a, "2026-09-29")
    assert (merged, errors) == (1, [])
    assert titles["tt0000003"] == TitleRow("tt0000003", "Gamma Movie", "Gamma Movie", "Phim Gamma", "machine", "2026-09-29")


def test_merge_rejects_bad_rows_and_keeps_good_ones(tmp_path, crawl_a, titles):
    path = tmp_path / "todo.csv"
    write_csv(path, TODO_HEADER, [
        ["tt0000003", "", "", "", "", "Gamma Movie", "Phim Gamma"],
        ["tt0000003", "", "", "", "", "Gamma", "Gamma"],
        ["tt0000404", "", "", "", "", "Ghost", "Ma"],
        ["tt0000001", "", "", "", "", "Alpha Movie", ""],
        ["tt0000002", "", "", "", "", "Beta", "Beta mới"],
    ])
    merged, errors = merge_todo(path, titles, crawl_a, "2026-09-29")
    assert merged == 1
    assert len(errors) == 4
    assert "duplicate" in errors[0] and "unknown" in errors[1]
    assert "required" in errors[2] and "reviewed" in errors[3]
    assert titles["tt0000002"].title_vi == "Phim Beta"
    assert titles["tt0000001"].title_vi == "Phim Alpha"


def test_cli_todo_then_merge(tmp_path):
    titles_path = tmp_path / "titles.csv"
    shutil.copy(FIXTURES / "movie_titles.csv", titles_path)
    todo = tmp_path / "todo.csv"
    common = ["--input", str(FIXTURES / "crawl_a"), "--titles", str(titles_path), "--todo-file", str(todo)]
    assert main(["--todo", *common]) == 0
    rows = list(csv.DictReader(todo.open(encoding="utf-8")))
    assert [r["imdb_id"] for r in rows] == ["tt0000003"]
    write_csv(todo, TODO_HEADER, [["tt0000003", "Gamma Movie", "", "2010", "Sci-Fi", "Gamma Movie", "Phim Gamma"]])
    assert main(["--merge", *common]) == 0
    assert load_titles(titles_path)["tt0000003"].title_vi == "Phim Gamma"
    write_csv(todo, TODO_HEADER, [["tt0000404", "", "", "", "", "X", "Y"]])
    assert main(["--merge", *common]) == 1
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_translate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.translate'`

- [ ] **Step 4: Write the implementation**

`pipeline/translate.py`:
```python
"""English/Vietnamese movie titles: the title store, a worklist for Claude Code, and a validated merge.

Workflow for movies without titles:
    python -m pipeline.translate --todo    # writes translations/todo.csv
    (Claude Code fills in title_en and title_vi in todo.csv)
    python -m pipeline.translate --merge   # validates and merges into translations/movie_titles.csv
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

from .config import DEFAULT_INPUT, TITLES_PATH, TODO_PATH, utf8_stdout
from .load import Crawl, Movie, load_crawl

FIELDS = ["imdb_id", "primary_title", "title_en", "title_vi", "source", "translated_at"]
TODO_FIELDS = ["imdb_id", "primary_title", "original_title", "year", "genres", "title_en", "title_vi"]
SOURCES = ("machine", "reviewed")


@dataclass(frozen=True)
class TitleRow:
    imdb_id: str
    primary_title: str
    title_en: str
    title_vi: str
    source: str  # "machine" (translated by Claude Code) or "reviewed" (checked by a person)
    translated_at: str


def load_titles(path: Path) -> dict[str, TitleRow]:
    if not path.exists():
        return {}
    rows: dict[str, TitleRow] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for raw in csv.DictReader(f):
            row = TitleRow(**{key: (raw.get(key) or "").strip() for key in FIELDS})
            if row.source not in SOURCES:
                raise ValueError(f"{path}: {row.imdb_id}: source must be one of {SOURCES}, got {row.source!r}")
            rows[row.imdb_id] = row
    return rows


def save_titles(path: Path, rows: dict[str, TitleRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        for imdb_id in sorted(rows):
            writer.writerow(asdict(rows[imdb_id]))


def needs_translation(crawl: Crawl, titles: dict[str, TitleRow]) -> list[Movie]:
    """Movies with no title row, or whose IMDb title changed since a machine translation."""
    result = []
    for imdb_id in sorted(crawl.movies):
        movie = crawl.movies[imdb_id]
        row = titles.get(imdb_id)
        if row is None or (row.source != "reviewed" and row.primary_title != movie.primary_title):
            result.append(movie)
    return result


def write_todo(path: Path, crawl: Crawl, movies: list[Movie]) -> None:
    genres: dict[str, list[str]] = {}
    for imdb_id, genre in crawl.movie_genres:
        genres.setdefault(imdb_id, []).append(genre)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=TODO_FIELDS, lineterminator="\n")
        writer.writeheader()
        for movie in movies:
            writer.writerow({
                "imdb_id": movie.imdb_id,
                "primary_title": movie.primary_title,
                "original_title": movie.original_title or "",
                "year": movie.release_year or "",
                "genres": ", ".join(sorted(genres.get(movie.imdb_id, []))),
                "title_en": "",
                "title_vi": "",
            })


def merge_todo(path: Path, titles: dict[str, TitleRow], crawl: Crawl, today: str) -> tuple[int, list[str]]:
    """Merge filled-in worklist rows into `titles`; returns (merged count, rejection messages)."""
    merged, errors, seen = 0, [], set()
    with path.open(encoding="utf-8-sig", newline="") as f:
        for line, raw in enumerate(csv.DictReader(f), start=2):
            imdb_id = (raw.get("imdb_id") or "").strip()
            title_en = (raw.get("title_en") or "").strip()
            title_vi = (raw.get("title_vi") or "").strip()
            existing = titles.get(imdb_id)
            if imdb_id in seen:
                problem = "duplicate imdb_id in worklist"
            elif imdb_id not in crawl.movies:
                problem = "unknown imdb_id"
            elif not title_en or not title_vi:
                problem = "title_en and title_vi are required"
            elif existing is not None and existing.source == "reviewed":
                problem = "reviewed title is never overwritten"
            else:
                problem = None
            seen.add(imdb_id)
            if problem:
                errors.append(f"{path.name}:{line} {imdb_id or '?'}: {problem}")
                continue
            titles[imdb_id] = TitleRow(
                imdb_id, crawl.movies[imdb_id].primary_title, title_en, title_vi, "machine", today
            )
            merged += 1
    return merged, errors


def main(argv: list[str] | None = None) -> int:
    utf8_stdout()
    parser = argparse.ArgumentParser(prog="python -m pipeline.translate", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--todo", action="store_true", help="write the worklist of movies that need titles")
    mode.add_argument("--merge", action="store_true", help="validate the worklist and merge it into the title store")
    parser.add_argument("--input", action="append", type=Path, help="crawl folder (repeatable; default: data/)")
    parser.add_argument("--titles", type=Path, default=TITLES_PATH, help="title store CSV")
    parser.add_argument("--todo-file", type=Path, default=TODO_PATH, help="worklist CSV")
    args = parser.parse_args(argv)

    crawl = load_crawl(args.input or [DEFAULT_INPUT])
    titles = load_titles(args.titles)
    if args.todo:
        movies = needs_translation(crawl, titles)
        write_todo(args.todo_file, crawl, movies)
        print(f"{len(movies)} movie(s) need titles -> {args.todo_file}")
        return 0
    merged, errors = merge_todo(args.todo_file, titles, crawl, date.today().isoformat())
    save_titles(args.titles, titles)
    print(f"merged {merged} title(s) into {args.titles}")
    for error in errors:
        print(f"  rejected {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_translate.py -v`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add pipeline/translate.py tests/test_translate.py tests/fixtures/movie_titles.csv
git commit -m "feat: title store with translation worklist and validated merge"
```

---

### Task 5: Transform (4★ data graph)

**Files:**
- Create: `pipeline/transform.py`
- Test: `tests/test_transform.py`

**Interfaces:**
- Consumes: `load.Crawl`, `load.Movie`, `load.Person`, `load.Credit`; `translate.TitleRow`, `translate.load_titles`; `uris.*`; `config.MO`, `config.SCHEMA`, `config.bind_namespaces`, `config.ONTOLOGY_PATH`.
- Produces: `build_data_graph(crawl: Crawl, titles: dict[str, TitleRow]) -> tuple[Graph, list[str]]` (graph, warnings); constant `ROLE_PROPERTY: dict[str, URIRef]`.

- [ ] **Step 1: Write the failing tests**

`tests/test_transform.py`:
```python
from decimal import Decimal

import pytest
from rdflib import BNode, Graph, Literal
from rdflib.namespace import FOAF, OWL, RDF, RDFS, SKOS

from pipeline.config import MO, ONTOLOGY_PATH, SCHEMA
from pipeline.transform import build_data_graph
from pipeline.translate import load_titles
from pipeline.uris import (
    GENRE_SCHEME,
    credit_uri,
    genre_uri,
    imdb_title_page,
    movie_uri,
    person_uri,
    profession_uri,
)
from tests.conftest import FIXTURES


@pytest.fixture
def built(crawl_a):
    return build_data_graph(crawl_a, load_titles(FIXTURES / "movie_titles.csv"))


@pytest.fixture
def g(built):
    return built[0]


def test_movie_triples(g):
    m = movie_uri("tt0000001")
    expected = [
        (m, RDF.type, MO.Movie),
        (m, MO.imdbId, Literal("tt0000001")),
        (m, MO.primaryTitle, Literal("Alpha Movie")),
        (m, MO.originalTitle, Literal("Alpha Film")),
        (m, RDFS.label, Literal("Alpha Movie", lang="en")),
        (m, RDFS.label, Literal("Phim Alpha", lang="vi")),
        (m, SCHEMA.name, Literal("Phim Alpha", lang="vi")),
        (m, MO.releaseYear, Literal(1990)),
        (m, MO.runtimeMinutes, Literal(100)),
        (m, MO.averageRating, Literal(Decimal("7.5"))),
        (m, MO.numVotes, Literal(1000)),
        (m, MO.hasGenre, genre_uri("Action")),
        (m, MO.hasGenre, genre_uri("Comedy")),
        (m, MO.sampledForGenre, genre_uri("Action")),
        (m, MO.hasActor, person_uri("nm0000001")),
        (m, MO.directedBy, person_uri("nm0000002")),
        (m, MO.hasCredit, credit_uri("tt0000001", 1)),
        (m, RDFS.seeAlso, imdb_title_page("tt0000001")),
        (m, FOAF.isPrimaryTopicOf, imdb_title_page("tt0000001")),
    ]
    for triple in expected:
        assert triple in g, triple
    assert len(list(g.objects(m, RDFS.label))) == 2


def test_missing_values_produce_no_triples(g):
    assert g.value(movie_uri("tt0000002"), MO.runtimeMinutes) is None
    assert g.value(person_uri("nm0000003"), MO.birthYear) is None


def test_untranslated_movie_gets_untagged_fallback_label(built):
    g, warnings = built
    m = movie_uri("tt0000003")
    assert list(g.objects(m, RDFS.label)) == [Literal("Gamma Movie")]
    assert any("tt0000003" in w and "no translation" in w for w in warnings)


def test_unicode_original_title_preserved(g):
    assert (movie_uri("tt0000003"), MO.originalTitle, Literal("第一类型危险")) in g


def test_person_triples(g):
    p = person_uri("nm0000001")
    assert (p, RDF.type, MO.Person) in g
    assert (p, RDFS.label, Literal("Ann Actor")) in g
    assert (p, MO.birthYear, Literal(1960)) in g
    assert (p, MO.primaryProfession, profession_uri("actress")) in g
    assert list(g.objects(p, MO.knownFor)) == [movie_uri("tt0000001")]  # tt9999999 is not in the dataset
    assert (person_uri("nm0000002"), MO.deathYear, Literal(2020)) in g


def test_credit_triples(g):
    c = credit_uri("tt0000001", 1)
    assert (c, RDF.type, MO.Credit) in g
    assert (c, MO.creditedPerson, person_uri("nm0000001")) in g
    assert (c, MO.creditRole, profession_uri("actress")) in g
    assert (c, MO.billingOrder, Literal(1)) in g
    assert set(g.objects(c, MO.characterName)) == {Literal("Hero"), Literal("Villain")}
    assert (credit_uri("tt0000001", 3), MO.job, Literal("composer")) in g
    assert g.value(c, MO.job) is None


def test_concepts(g):
    action = genre_uri("Action")
    assert (action, RDF.type, MO.Genre) in g
    assert (action, RDF.type, SKOS.Concept) in g
    assert (action, SKOS.prefLabel, Literal("Action", lang="en")) in g
    assert (action, SKOS.inScheme, GENRE_SCHEME) in g
    assert (action, MO.isTargetGenre, Literal(True)) in g
    assert (genre_uri("Comedy"), MO.isTargetGenre, Literal(False)) in g
    assert (GENRE_SCHEME, RDF.type, SKOS.ConceptScheme) in g
    casting = profession_uri("composer")
    assert (casting, RDF.type, MO.Profession) in g
    assert (casting, SKOS.prefLabel, Literal("composer", lang="en")) in g


def test_no_blank_nodes(g):
    assert not any(isinstance(term, BNode) for triple in g for term in triple)


def test_only_declared_ontology_terms_are_used(g):
    onto = Graph().parse(ONTOLOGY_PATH)
    declared = {s for kind in (OWL.Class, OWL.ObjectProperty, OWL.DatatypeProperty)
                for s in onto.subjects(RDF.type, kind)}
    used = {p for p in g.predicates() if str(p).startswith(str(MO))}
    used |= {o for o in g.objects(None, RDF.type) if str(o).startswith(str(MO))}
    assert used - declared == set()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_transform.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.transform'`

- [ ] **Step 3: Write the implementation**

`pipeline/transform.py`:
```python
"""4-star layer: turn the crawl into RDF that follows the ontology, with a URI for every thing."""

from __future__ import annotations

from rdflib import Graph, Literal, URIRef
from rdflib.namespace import FOAF, RDF, RDFS, SKOS

from .config import MO, SCHEMA, bind_namespaces
from .load import Crawl, Credit, Movie, Person
from .translate import TitleRow
from .uris import (
    GENRE_SCHEME,
    PROFESSION_SCHEME,
    credit_uri,
    genre_uri,
    imdb_name_page,
    imdb_title_page,
    movie_uri,
    person_uri,
    profession_uri,
)

ROLE_PROPERTY = {"actor": MO.hasActor, "director": MO.directedBy, "writer": MO.writtenBy}


def build_data_graph(crawl: Crawl, titles: dict[str, TitleRow]) -> tuple[Graph, list[str]]:
    graph = bind_namespaces(Graph())
    warnings: list[str] = []

    _add_scheme(graph, GENRE_SCHEME, "Movie genres")
    _add_scheme(graph, PROFESSION_SCHEME, "Film professions")
    for name, is_target in sorted(crawl.genres.items()):
        _add_genre(graph, name, is_target)
    for name in sorted(crawl.professions):
        _add_profession(graph, name)

    for movie in crawl.movies.values():
        _add_movie(graph, movie, titles.get(movie.imdb_id), warnings)
    for person in crawl.people.values():
        _add_person(graph, person, crawl.movies.keys())
    for credit in crawl.credits.values():
        _add_credit(graph, credit)

    for imdb_id, genre in crawl.movie_genres:
        graph.add((movie_uri(imdb_id), MO.hasGenre, genre_uri(genre)))
    for imdb_id, genre in crawl.sampling:
        graph.add((movie_uri(imdb_id), MO.sampledForGenre, genre_uri(genre)))
    for imdb_id, person_id, role in crawl.movie_people:
        graph.add((movie_uri(imdb_id), ROLE_PROPERTY[role], person_uri(person_id)))
    return graph, warnings


def _add_scheme(graph: Graph, scheme: URIRef, label: str) -> None:
    graph.add((scheme, RDF.type, SKOS.ConceptScheme))
    graph.add((scheme, SKOS.prefLabel, Literal(label, lang="en")))


def _add_genre(graph: Graph, name: str, is_target: bool) -> None:
    uri = genre_uri(name)
    graph.add((uri, RDF.type, MO.Genre))
    graph.add((uri, RDF.type, SKOS.Concept))
    graph.add((uri, SKOS.prefLabel, Literal(name, lang="en")))
    graph.add((uri, SKOS.inScheme, GENRE_SCHEME))
    graph.add((uri, MO.isTargetGenre, Literal(is_target)))


def _add_profession(graph: Graph, name: str) -> None:
    uri = profession_uri(name)
    graph.add((uri, RDF.type, MO.Profession))
    graph.add((uri, RDF.type, SKOS.Concept))
    graph.add((uri, SKOS.prefLabel, Literal(name.replace("_", " "), lang="en")))
    graph.add((uri, SKOS.inScheme, PROFESSION_SCHEME))


def _add_movie(graph: Graph, movie: Movie, title: TitleRow | None, warnings: list[str]) -> None:
    uri = movie_uri(movie.imdb_id)
    graph.add((uri, RDF.type, MO.Movie))
    graph.add((uri, MO.imdbId, Literal(movie.imdb_id)))
    graph.add((uri, MO.primaryTitle, Literal(movie.primary_title)))
    if movie.original_title:
        graph.add((uri, MO.originalTitle, Literal(movie.original_title)))

    if title is None:
        warnings.append(f"{movie.imdb_id}: no translation, using the untagged primary title as label")
        labels = [Literal(movie.primary_title)]
    else:
        if title.primary_title != movie.primary_title:
            warnings.append(f"{movie.imdb_id}: title was translated from an older IMDb title {title.primary_title!r}")
        labels = [Literal(title.title_en, lang="en"), Literal(title.title_vi, lang="vi")]
    for label in labels:
        graph.add((uri, RDFS.label, label))
        graph.add((uri, SCHEMA.name, label))

    for prop, value in (
        (MO.releaseYear, movie.release_year),
        (MO.runtimeMinutes, movie.runtime_minutes),
        (MO.averageRating, movie.average_rating),
        (MO.numVotes, movie.num_votes),
    ):
        if value is not None:
            graph.add((uri, prop, Literal(value)))

    page = imdb_title_page(movie.imdb_id)
    graph.add((uri, RDFS.seeAlso, page))
    graph.add((uri, FOAF.isPrimaryTopicOf, page))


def _add_person(graph: Graph, person: Person, movie_ids) -> None:
    uri = person_uri(person.person_id)
    graph.add((uri, RDF.type, MO.Person))
    graph.add((uri, RDFS.label, Literal(person.name)))
    graph.add((uri, SCHEMA.name, Literal(person.name)))
    graph.add((uri, MO.imdbId, Literal(person.person_id)))
    if person.birth_year is not None:
        graph.add((uri, MO.birthYear, Literal(person.birth_year)))
    if person.death_year is not None:
        graph.add((uri, MO.deathYear, Literal(person.death_year)))
    for profession in person.professions:
        graph.add((uri, MO.primaryProfession, profession_uri(profession)))
    for imdb_id in person.known_for:
        if imdb_id in movie_ids:
            graph.add((uri, MO.knownFor, movie_uri(imdb_id)))
    page = imdb_name_page(person.person_id)
    graph.add((uri, RDFS.seeAlso, page))
    graph.add((uri, FOAF.isPrimaryTopicOf, page))


def _add_credit(graph: Graph, credit: Credit) -> None:
    uri = credit_uri(credit.imdb_id, credit.ordering)
    graph.add((movie_uri(credit.imdb_id), MO.hasCredit, uri))
    graph.add((uri, RDF.type, MO.Credit))
    graph.add((uri, MO.creditedPerson, person_uri(credit.person_id)))
    graph.add((uri, MO.creditRole, profession_uri(credit.category)))
    graph.add((uri, MO.billingOrder, Literal(credit.ordering)))
    if credit.job:
        graph.add((uri, MO.job, Literal(credit.job)))
    for character in credit.characters:
        graph.add((uri, MO.characterName, Literal(character)))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_transform.py -v`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add pipeline/transform.py tests/test_transform.py
git commit -m "feat: transform crawl into 4-star RDF data graph"
```

---

### Task 6: Wikidata client, link store and incremental resolution

**Files:**
- Create: `pipeline/link.py`, `tests/fakes.py`, `tests/fixtures/wikidata_response.json`
- Test: `tests/test_link_resolve.py`

**Interfaces:**
- Consumes: `config.DBR`, `config.USER_AGENT`, `config.WIKIDATA_ENDPOINT`, `config.WIKIDATA_BATCH_SIZE`, `config.WIKIDATA_PAUSE_SECONDS`.
- Produces: `LinkRow(imdb_id, wikidata_qid, enwiki_title, checked_at)` (dataclass; empty `wikidata_qid` = checked, no match); `WikidataError(RuntimeError)`; `WikidataClient(session=None, endpoint=WIKIDATA_ENDPOINT, cache_dir: Path|None=None, max_retries=5, sleep=time.sleep)` with `lookup(imdb_ids: list[str]) -> dict[str, list[tuple[str, str]]]` (IMDb ID → [(qid, enwiki_title)]); `enwiki_title(article_url: str) -> str`; `dbpedia_iri(title: str) -> URIRef`; `load_link_store(path) -> dict[str, LinkRow]`; `save_link_store(path, store) -> None`; `resolve_links(ids, store, client, *, refresh=False, batch_size=WIKIDATA_BATCH_SIZE, pause=WIKIDATA_PAUSE_SECONDS, sleep=time.sleep, now: str|None=None) -> list[str]` (mutates `store`, returns warnings).
- Produces (tests): `tests.fakes.FakeClient(answers: dict[str, list[tuple[str,str]]], fail_on_call: int|None=None)` with `.batches: list[list[str]]`; `FakeSession(responses)`, `FakeResponse(status, payload=None, headers=None)`.

- [ ] **Step 1: Create the fakes and the recorded response**

`tests/fakes.py`:
```python
"""Test doubles for the Wikidata SPARQL endpoint."""

import json

from pipeline.link import WikidataError


class FakeResponse:
    def __init__(self, status, payload=None, headers=None):
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}
        self.text = json.dumps(payload) if payload is not None else ""

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.headers = {}
        self.queries = []

    def post(self, url, data=None, timeout=None):
        self.queries.append(data["query"])
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class FakeClient:
    """Answers lookups from a dict; optionally fails on the N-th call (1-based)."""

    def __init__(self, answers, fail_on_call=None):
        self.answers = answers
        self.fail_on_call = fail_on_call
        self.batches = []

    def lookup(self, imdb_ids):
        self.batches.append(list(imdb_ids))
        if self.fail_on_call == len(self.batches):
            raise WikidataError("simulated outage")
        return {i: self.answers[i] for i in imdb_ids if i in self.answers}
```

`tests/fixtures/wikidata_response.json`:
```json
{
  "head": {"vars": ["imdb", "item", "article"]},
  "results": {
    "bindings": [
      {"imdb": {"type": "literal", "value": "tt0000001"},
       "item": {"type": "uri", "value": "http://www.wikidata.org/entity/Q100"}},
      {"imdb": {"type": "literal", "value": "tt0000001"},
       "item": {"type": "uri", "value": "http://www.wikidata.org/entity/Q50"},
       "article": {"type": "uri", "value": "https://en.wikipedia.org/wiki/Alpha_Movie"}},
      {"imdb": {"type": "literal", "value": "nm0000001"},
       "item": {"type": "uri", "value": "http://www.wikidata.org/entity/Q200"},
       "article": {"type": "uri", "value": "https://en.wikipedia.org/wiki/Ann_Act%C3%B6r_(actress)"}},
      {"imdb": {"type": "literal", "value": "tt0000002"},
       "item": {"type": "uri", "value": "http://www.wikidata.org/entity/Q300"}}
    ]
  }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/test_link_resolve.py`:
```python
import json

import pytest
import requests
from rdflib import Graph, URIRef
from rdflib.namespace import OWL

from pipeline.link import (
    LinkRow,
    WikidataClient,
    WikidataError,
    dbpedia_iri,
    enwiki_title,
    load_link_store,
    resolve_links,
    save_link_store,
)
from tests.conftest import FIXTURES
from tests.fakes import FakeClient, FakeResponse, FakeSession

RECORDED = json.loads((FIXTURES / "wikidata_response.json").read_text(encoding="utf-8"))
NOW = "2026-09-28T00:00:00Z"


def no_sleep(seconds):
    pass


def test_lookup_parses_recorded_response(tmp_path):
    session = FakeSession([FakeResponse(200, RECORDED)])
    client = WikidataClient(session=session, cache_dir=tmp_path / "cache", sleep=no_sleep)
    result = client.lookup(["tt0000001", "nm0000001", "tt0000002", "tt0000003"])
    assert result == {
        "tt0000001": [("Q100", ""), ("Q50", "Alpha_Movie")],
        "nm0000001": [("Q200", "Ann_Actör_(actress)")],
        "tt0000002": [("Q300", "")],
    }
    assert '"tt0000003"' in session.queries[0] and "wdt:P345" in session.queries[0]
    assert "lod-movie" in session.headers["User-Agent"]
    assert len(list((tmp_path / "cache").glob("*.json"))) == 1


def test_lookup_retries_429_honouring_retry_after():
    waits = []
    session = FakeSession([FakeResponse(429, headers={"Retry-After": "7"}), FakeResponse(503), FakeResponse(200, RECORDED)])
    client = WikidataClient(session=session, sleep=waits.append)
    assert "tt0000001" in client.lookup(["tt0000001"])
    assert waits == [7.0, 2]


def test_lookup_retries_connection_errors_then_gives_up():
    session = FakeSession([requests.ConnectionError("down")] * 3)
    client = WikidataClient(session=session, max_retries=2, sleep=no_sleep)
    with pytest.raises(WikidataError, match="3 attempts"):
        client.lookup(["tt0000001"])


def test_lookup_does_not_retry_client_errors():
    session = FakeSession([FakeResponse(400, {"error": "bad query"})])
    with pytest.raises(WikidataError, match="HTTP 400"):
        WikidataClient(session=session, sleep=no_sleep).lookup(["tt0000001"])


def test_enwiki_title_and_dbpedia_iri():
    assert enwiki_title("https://en.wikipedia.org/wiki/Am%C3%A9lie") == "Amélie"
    assert dbpedia_iri("Amélie") == URIRef("http://dbpedia.org/resource/Amélie")
    assert dbpedia_iri("Time_Bandits") == URIRef("http://dbpedia.org/resource/Time_Bandits")


def test_dbpedia_iri_special_characters_roundtrip():
    titles = ['What_Ever_Happened?', "C#_(film)", "100%_Love", 'Say_"Hello"', "Léon:_The_Professional", "AC/DC_Live"]
    iris = [dbpedia_iri(t) for t in titles]
    assert iris[0] == URIRef("http://dbpedia.org/resource/What_Ever_Happened%3F")
    assert iris[1] == URIRef("http://dbpedia.org/resource/C%23_(film)")
    assert iris[2] == URIRef("http://dbpedia.org/resource/100%25_Love")
    assert iris[3] == URIRef("http://dbpedia.org/resource/Say_%22Hello%22")
    g = Graph()
    subject = URIRef("https://lod-movie.felix-nguyen.io.vn/resource/movie/tt1")
    for iri in iris:
        g.add((subject, OWL.sameAs, iri))
    reparsed = Graph().parse(data=g.serialize(format="nt"), format="nt")
    assert set(reparsed.objects(subject, OWL.sameAs)) == set(iris)


def test_link_store_roundtrip(tmp_path):
    store = {
        "tt2": LinkRow("tt2", "", "", NOW),
        "tt1": LinkRow("tt1", "Q50", "Amélie", NOW),
    }
    path = tmp_path / "movies.csv"
    save_link_store(path, store)
    assert load_link_store(path) == store
    assert path.read_text(encoding="utf-8").splitlines()[1].startswith("tt1,")
    assert load_link_store(tmp_path / "missing.csv") == {}


def test_resolve_only_queries_new_ids_and_keeps_lowest_qid():
    store = {"tt0000001": LinkRow("tt0000001", "Q1", "Old", NOW)}
    client = FakeClient({"tt0000002": [("Q300", ""), ("Q30", "Beta_Movie")]})
    warnings = resolve_links(["tt0000001", "tt0000002", "tt0000003"], store, client, now=NOW, sleep=no_sleep)
    assert client.batches == [["tt0000002", "tt0000003"]]
    assert store["tt0000002"] == LinkRow("tt0000002", "Q30", "Beta_Movie", NOW)
    assert store["tt0000003"] == LinkRow("tt0000003", "", "", NOW)
    assert store["tt0000001"].wikidata_qid == "Q1"
    assert any("tt0000002" in w and "Q30" in w and "Q300" in w for w in warnings)


def test_resolve_refresh_rechecks_everything():
    store = {"tt0000001": LinkRow("tt0000001", "Q1", "Old", NOW)}
    client = FakeClient({"tt0000001": [("Q2", "New")]})
    resolve_links(["tt0000001"], store, client, refresh=True, now=NOW, sleep=no_sleep)
    assert client.batches == [["tt0000001"]]
    assert store["tt0000001"].wikidata_qid == "Q2"


def test_resolve_batches_and_pauses():
    pauses = []
    client = FakeClient({})
    resolve_links([f"tt{i}" for i in range(5)], {}, client, batch_size=2, pause=1.5, now=NOW, sleep=pauses.append)
    assert [len(b) for b in client.batches] == [2, 2, 1]
    assert pauses == [1.5, 1.5]


def test_resolve_offline_warns_and_changes_nothing():
    store = {}
    warnings = resolve_links(["tt1", "tt2"], store, None, now=NOW)
    assert store == {}
    assert warnings == ["offline: 2 ID(s) not checked against Wikidata"]


def test_resolve_keeps_successful_batches_on_failure():
    store = {}
    client = FakeClient({"tt0": [("Q9", "Zero")]}, fail_on_call=2)
    warnings = resolve_links(["tt0", "tt1", "tt2", "tt3"], store, client, batch_size=2, now=NOW, sleep=no_sleep)
    assert sorted(store) == ["tt0", "tt1"]
    assert store["tt0"].wikidata_qid == "Q9"
    assert any("2 ID(s) left unchecked" in w for w in warnings)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_link_resolve.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.link'`

- [ ] **Step 4: Write the implementation**

`pipeline/link.py`:
```python
"""5-star layer: link movies and people to Wikidata and DBpedia, and concepts via SKOS mappings."""

from __future__ import annotations

import csv
import hashlib
import json
import time
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

import requests
from rdflib import URIRef

from .config import (
    DBR,
    USER_AGENT,
    WIKIDATA_BATCH_SIZE,
    WIKIDATA_ENDPOINT,
    WIKIDATA_PAUSE_SECONDS,
)

STORE_FIELDS = ["imdb_id", "wikidata_qid", "enwiki_title", "checked_at"]

QUERY = """SELECT ?imdb ?item ?article WHERE {{
  VALUES ?imdb {{ {values} }}
  ?item wdt:P345 ?imdb .
  OPTIONAL {{ ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }}
}}"""

# Characters kept as-is in DBpedia IRIs; everything else ASCII is percent-encoded.
_IRI_SAFE = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~!$&'()*+,;=:@/")


class WikidataError(RuntimeError):
    """Wikidata could not answer, even after retries."""


@dataclass
class LinkRow:
    imdb_id: str
    wikidata_qid: str  # empty = checked, no Wikidata item has this IMDb ID
    enwiki_title: str  # decoded English Wikipedia title, empty if none
    checked_at: str


class WikidataClient:
    def __init__(
        self,
        session=None,
        endpoint: str = WIKIDATA_ENDPOINT,
        cache_dir: Path | None = None,
        max_retries: int = 5,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"})
        self.endpoint = endpoint
        self.cache_dir = cache_dir
        self.max_retries = max_retries
        self.sleep = sleep

    def lookup(self, imdb_ids: list[str]) -> dict[str, list[tuple[str, str]]]:
        """Map each IMDb ID to its Wikidata items as (QID, English Wikipedia title); unmatched IDs are absent."""
        query = QUERY.format(values=" ".join(f'"{imdb_id}"' for imdb_id in imdb_ids))
        data = self._post(query)
        if self.cache_dir is not None:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            name = hashlib.sha1(query.encode("utf-8")).hexdigest()[:16]
            (self.cache_dir / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        result: dict[str, list[tuple[str, str]]] = {}
        for binding in data["results"]["bindings"]:
            imdb_id = binding["imdb"]["value"]
            qid = binding["item"]["value"].rsplit("/", 1)[1]
            title = enwiki_title(binding["article"]["value"]) if "article" in binding else ""
            result.setdefault(imdb_id, []).append((qid, title))
        return result

    def _post(self, query: str) -> dict:
        error = ""
        for attempt in range(self.max_retries + 1):
            wait: float = 2**attempt
            try:
                response = self.session.post(self.endpoint, data={"query": query}, timeout=90)
            except requests.RequestException as exc:
                error = str(exc)
            else:
                if response.status_code == 200:
                    return response.json()
                if response.status_code != 429 and response.status_code < 500:
                    raise WikidataError(f"HTTP {response.status_code}: {response.text[:200]}")
                error = f"HTTP {response.status_code}"
                try:
                    wait = float(response.headers.get("Retry-After", wait))
                except ValueError:
                    pass
            if attempt < self.max_retries:
                self.sleep(wait)
        raise WikidataError(f"giving up after {self.max_retries + 1} attempts: {error}")


def enwiki_title(article_url: str) -> str:
    return unquote(article_url.split("/wiki/", 1)[1])


def dbpedia_iri(title: str) -> URIRef:
    """DBpedia resource IRI for an English Wikipedia title (DBpedia keeps non-ASCII characters as-is)."""
    parts = []
    for char in title.replace(" ", "_"):
        if ord(char) > 127 or char in _IRI_SAFE:
            parts.append(char)
        else:
            parts.append("".join(f"%{byte:02X}" for byte in char.encode("utf-8")))
    return URIRef(str(DBR) + "".join(parts))


def load_link_store(path: Path) -> dict[str, LinkRow]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        return {row["imdb_id"]: LinkRow(**{k: row.get(k) or "" for k in STORE_FIELDS}) for row in csv.DictReader(f)}


def save_link_store(path: Path, store: dict[str, LinkRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=STORE_FIELDS, lineterminator="\n")
        writer.writeheader()
        for imdb_id in sorted(store):
            writer.writerow(asdict(store[imdb_id]))


def resolve_links(
    ids: Iterable[str],
    store: dict[str, LinkRow],
    client: WikidataClient | None,
    *,
    refresh: bool = False,
    batch_size: int = WIKIDATA_BATCH_SIZE,
    pause: float = WIKIDATA_PAUSE_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    now: str | None = None,
) -> list[str]:
    """Check IDs against Wikidata and record the result in `store`; returns warnings."""
    wanted = sorted(set(ids))
    pending = wanted if refresh else [i for i in wanted if i not in store]
    if not pending:
        return []
    if client is None:
        return [f"offline: {len(pending)} ID(s) not checked against Wikidata"]
    checked_at = now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    warnings: list[str] = []
    for start in range(0, len(pending), batch_size):
        batch = pending[start : start + batch_size]
        if start:
            sleep(pause)
        try:
            found = client.lookup(batch)
        except WikidataError as exc:
            warnings.append(f"Wikidata unavailable ({exc}); {len(pending) - start} ID(s) left unchecked")
            break
        for imdb_id in batch:
            matches = sorted(found.get(imdb_id, []), key=lambda match: int(match[0][1:]))
            if not matches:
                store[imdb_id] = LinkRow(imdb_id, "", "", checked_at)
                continue
            qid, title = matches[0]
            others = sorted({other for other, _ in matches[1:]} - {qid})
            if others:
                warnings.append(f"{imdb_id}: several Wikidata items {[qid, *others]}, kept {qid}")
            store[imdb_id] = LinkRow(imdb_id, qid, title, checked_at)
    return warnings
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_link_resolve.py -v`
Expected: PASS (12 tests)

- [ ] **Step 6: Commit**

```bash
git add pipeline/link.py tests/fakes.py tests/test_link_resolve.py tests/fixtures/wikidata_response.json
git commit -m "feat: Wikidata client with retries, link store and incremental resolution"
```

---

### Task 7: Concept mappings and the link graph

**Files:**
- Modify: `pipeline/link.py` (append)
- Create: `tests/fixtures/mappings/genres.csv`, `tests/fixtures/mappings/professions.csv`
- Test: `tests/test_link_graph.py`

**Interfaces:**
- Consumes: `LinkRow`, `dbpedia_iri` (Task 6); `load.Crawl`; `uris.movie_uri`, `person_uri`, `genre_uri`, `profession_uri`; `config.WD`, `config.bind_namespaces`.
- Produces: `Mapping(source_value, wikidata_qid, dbpedia_resource, match_type)` (frozen dataclass); `load_mappings(path) -> dict[str, Mapping]` (rows with empty QID skipped; bad `match_type` → `ValueError`); `build_link_graph(crawl, movie_links, person_links, genre_map, profession_map) -> tuple[Graph, dict]` where the report dict has keys `movies`, `people` (`total`, `wikidata`, `dbpedia`, `wikidata_pct`, `unmatched`, `unchecked`) and `genres`, `professions` (`total`, `mapped`, `unmapped`).

- [ ] **Step 1: Create mapping fixtures**

`tests/fixtures/mappings/genres.csv`:
```
source_value,wikidata_qid,dbpedia_resource,match_type
Action,Q188473,Action_film,exact
Drama,Q130232,Drama_(film_and_television),exact
Comedy,,,
```

`tests/fixtures/mappings/professions.csv`:
```
source_value,wikidata_qid,dbpedia_resource,match_type
actress,Q33999,Actor,close
director,Q2526255,Film_director,exact
```

- [ ] **Step 2: Write the failing tests**

`tests/test_link_graph.py`:
```python
import pytest
from rdflib import URIRef
from rdflib.namespace import OWL, SKOS

from pipeline.config import WD
from pipeline.link import LinkRow, Mapping, build_link_graph, load_mappings
from pipeline.uris import genre_uri, movie_uri, person_uri, profession_uri
from tests.conftest import FIXTURES

NOW = "2026-09-28T00:00:00Z"


@pytest.fixture
def maps():
    return (load_mappings(FIXTURES / "mappings" / "genres.csv"),
            load_mappings(FIXTURES / "mappings" / "professions.csv"))


def test_load_mappings(maps):
    genres, professions = maps
    assert genres["Action"] == Mapping("Action", "Q188473", "Action_film", "exact")
    assert "Comedy" not in genres
    assert professions["actress"].match_type == "close"


def test_load_mappings_rejects_bad_match_type(tmp_path):
    path = tmp_path / "m.csv"
    path.write_text("source_value,wikidata_qid,dbpedia_resource,match_type\nAction,Q1,Action_film,same\n", encoding="utf-8")
    with pytest.raises(ValueError, match="match_type"):
        load_mappings(path)


def test_build_link_graph(crawl_a, maps):
    movie_links = {
        "tt0000001": LinkRow("tt0000001", "Q50", "Alpha_Movie", NOW),
        "tt0000002": LinkRow("tt0000002", "Q300", "", NOW),
        "tt0000003": LinkRow("tt0000003", "", "", NOW),
    }
    person_links = {"nm0000001": LinkRow("nm0000001", "Q200", "Ann_Actör_(actress)", NOW)}
    g, report = build_link_graph(crawl_a, movie_links, person_links, *maps)

    alpha = movie_uri("tt0000001")
    assert (alpha, OWL.sameAs, WD.Q50) in g
    assert (alpha, OWL.sameAs, URIRef("http://dbpedia.org/resource/Alpha_Movie")) in g
    assert (movie_uri("tt0000002"), OWL.sameAs, WD.Q300) in g
    assert len(list(g.objects(movie_uri("tt0000002"), OWL.sameAs))) == 1
    assert (person_uri("nm0000001"), OWL.sameAs, URIRef("http://dbpedia.org/resource/Ann_Actör_(actress)")) in g
    assert (genre_uri("Action"), SKOS.exactMatch, WD.Q188473) in g
    assert (genre_uri("Action"), SKOS.exactMatch, URIRef("http://dbpedia.org/resource/Action_film")) in g
    assert (profession_uri("actress"), SKOS.closeMatch, WD.Q33999) in g

    assert report["movies"] == {"total": 3, "wikidata": 2, "dbpedia": 1, "wikidata_pct": 66.7,
                                "unmatched": ["tt0000003"], "unchecked": []}
    assert report["people"]["unchecked"] == ["nm0000002", "nm0000003"]
    assert report["genres"] == {"total": 4, "mapped": 2, "unmapped": ["Comedy", "Sci-Fi"]}
    assert report["professions"]["unmapped"] == ["composer", "producer", "writer"]
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_link_graph.py -v`
Expected: FAIL with `ImportError: cannot import name 'Mapping' from 'pipeline.link'`

- [ ] **Step 4: Append the implementation to `pipeline/link.py`**

Add to the imports at the top of `pipeline/link.py`:
```python
from rdflib import Graph
from rdflib.namespace import OWL, SKOS

from .config import WD, bind_namespaces
from .load import Crawl
from .uris import genre_uri, movie_uri, person_uri, profession_uri
```

Append at the end of `pipeline/link.py`:
```python
MAPPING_FIELDS = ["source_value", "wikidata_qid", "dbpedia_resource", "match_type"]
MATCH_PREDICATE = {"exact": SKOS.exactMatch, "close": SKOS.closeMatch}


@dataclass(frozen=True)
class Mapping:
    source_value: str
    wikidata_qid: str
    dbpedia_resource: str  # English Wikipedia / DBpedia title, may be empty
    match_type: str  # "exact" or "close"


def load_mappings(path: Path) -> dict[str, Mapping]:
    """Hand-checked concept mappings; rows without a QID mean 'deliberately unmapped'."""
    if not path.exists():
        return {}
    mappings: dict[str, Mapping] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            mapping = Mapping(**{k: (row.get(k) or "").strip() for k in MAPPING_FIELDS})
            if not mapping.wikidata_qid:
                continue
            if mapping.match_type not in MATCH_PREDICATE:
                raise ValueError(f"{path}: {mapping.source_value}: match_type must be exact or close")
            mappings[mapping.source_value] = mapping
    return mappings


def build_link_graph(
    crawl: Crawl,
    movie_links: dict[str, LinkRow],
    person_links: dict[str, LinkRow],
    genre_map: dict[str, Mapping],
    profession_map: dict[str, Mapping],
) -> tuple[Graph, dict]:
    graph = bind_namespaces(Graph())
    report = {
        "movies": _entity_links(graph, crawl.movies.keys(), movie_links, movie_uri),
        "people": _entity_links(graph, crawl.people.keys(), person_links, person_uri),
        "genres": _concept_links(graph, crawl.genres.keys(), genre_map, genre_uri),
        "professions": _concept_links(graph, crawl.professions, profession_map, profession_uri),
    }
    return graph, report


def _entity_links(graph: Graph, ids, store: dict[str, LinkRow], to_uri) -> dict:
    ids = sorted(ids)
    wikidata = dbpedia = 0
    unmatched, unchecked = [], []
    for imdb_id in ids:
        row = store.get(imdb_id)
        if row is None:
            unchecked.append(imdb_id)
            continue
        if not row.wikidata_qid:
            unmatched.append(imdb_id)
            continue
        subject = to_uri(imdb_id)
        graph.add((subject, OWL.sameAs, WD[row.wikidata_qid]))
        wikidata += 1
        if row.enwiki_title:
            graph.add((subject, OWL.sameAs, dbpedia_iri(row.enwiki_title)))
            dbpedia += 1
    total = len(ids)
    return {
        "total": total,
        "wikidata": wikidata,
        "dbpedia": dbpedia,
        "wikidata_pct": round(100 * wikidata / total, 1) if total else 0.0,
        "unmatched": unmatched,
        "unchecked": unchecked,
    }


def _concept_links(graph: Graph, values, mappings: dict[str, Mapping], to_uri) -> dict:
    values = sorted(values)
    unmapped = []
    for value in values:
        mapping = mappings.get(value)
        if mapping is None:
            unmapped.append(value)
            continue
        predicate = MATCH_PREDICATE[mapping.match_type]
        subject = to_uri(value)
        graph.add((subject, predicate, WD[mapping.wikidata_qid]))
        if mapping.dbpedia_resource:
            graph.add((subject, predicate, dbpedia_iri(mapping.dbpedia_resource)))
    return {"total": len(values), "mapped": len(values) - len(unmapped), "unmapped": unmapped}
```

Merge the two `rdflib` import lines into one (`from rdflib import Graph, URIRef`) and the two `.config` imports into one block so the module has a single import section.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_link_graph.py tests/test_link_resolve.py -v`
Expected: PASS (15 tests)

- [ ] **Step 6: Commit**

```bash
git add pipeline/link.py tests/test_link_graph.py tests/fixtures/mappings
git commit -m "feat: SKOS concept mappings and owl:sameAs link graph with coverage report"
```

---

### Task 8: VoID dataset description

**Files:**
- Create: `pipeline/void.py`
- Test: `tests/test_void.py`

**Interfaces:**
- Consumes: `load.Crawl`, `translate.TitleRow`, `config.*` (`DATASET_URI`, `DATASET_TITLE`, `DATASET_VERSION`, `LICENSE`, `RESOURCE`, `SPARQL_ENDPOINT`, `DATA_DUMP`, `MO`, `SCHEMA`, `DBO`, `WD`, `DBR`, `bind_namespaces`).
- Produces: `build_void(*, data: Graph, links: Graph, crawl: Crawl, titles: dict[str, TitleRow], modified: datetime) -> Graph`.

- [ ] **Step 1: Write the failing test**

`tests/test_void.py`:
```python
from datetime import datetime, timezone

import pytest
from rdflib import Literal, URIRef
from rdflib.namespace import DCAT, DCTERMS, RDF, VOID

from pipeline.config import MO, WD
from pipeline.link import LinkRow, build_link_graph, load_mappings
from pipeline.transform import build_data_graph
from pipeline.translate import load_titles
from pipeline.void import build_void
from tests.conftest import FIXTURES

DS = URIRef("https://lod-movie.felix-nguyen.io.vn/dataset")
VOID_CLASS = URIRef(str(VOID) + "class")
NOW = "2026-09-28T00:00:00Z"


@pytest.fixture
def void(crawl_a):
    titles = load_titles(FIXTURES / "movie_titles.csv")
    data, _ = build_data_graph(crawl_a, titles)
    links, _ = build_link_graph(
        crawl_a,
        {"tt0000001": LinkRow("tt0000001", "Q50", "Alpha_Movie", NOW)},
        {},
        load_mappings(FIXTURES / "mappings" / "genres.csv"),
        {},
    )
    g = build_void(data=data, links=links, crawl=crawl_a, titles=titles,
                   modified=datetime(2026, 9, 28, tzinfo=timezone.utc))
    return g, data, links


def test_dataset_metadata(void):
    g, data, links = void
    assert (DS, RDF.type, VOID.Dataset) in g
    assert (DS, RDF.type, DCAT.Dataset) in g
    assert g.value(DS, DCTERMS.license) == URIRef("https://developer.imdb.com/non-commercial-datasets/")
    assert g.value(DS, VOID.sparqlEndpoint) == URIRef("https://lod-movie.felix-nguyen.io.vn/sparql")
    assert URIRef("https://datasets.imdbws.com/title.basics.tsv.gz") in set(g.objects(DS, DCTERMS.source))
    assert g.value(DS, VOID.triples) == Literal(len(data) + len(links))
    assert g.value(DS, VOID.exampleResource) == URIRef("https://lod-movie.felix-nguyen.io.vn/resource/movie/tt0000001")
    description = str(g.value(DS, DCTERMS.description))
    assert "3 movies" in description and "1 machine-translated, 1 reviewed" in description


def test_class_partitions(void):
    g, _, _ = void
    counts = {g.value(p, VOID_CLASS): g.value(p, VOID.entities).toPython() for p in g.objects(DS, VOID.classPartition)}
    assert counts == {MO.Movie: 3, MO.Person: 3, MO.Credit: 5, MO.Genre: 4, MO.Profession: 5}


def test_linksets(void):
    g, _, _ = void
    wikidata = URIRef("https://lod-movie.felix-nguyen.io.vn/dataset/linkset/wikidata")
    assert (wikidata, RDF.type, VOID.Linkset) in g
    assert (DS, VOID.subset, wikidata) in g
    assert g.value(wikidata, VOID.triples) == Literal(3)  # 1 movie sameAs + 2 genre exactMatch
    dbpedia = URIRef("https://lod-movie.felix-nguyen.io.vn/dataset/linkset/dbpedia")
    assert g.value(dbpedia, VOID.triples) == Literal(3)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python -m pytest tests/test_void.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.void'`

- [ ] **Step 3: Write the implementation**

`pipeline/void.py`:
```python
"""VoID / DCAT description of the dataset, with statistics computed from the built graphs."""

from __future__ import annotations

from datetime import datetime

from rdflib import Graph, Literal, URIRef
from rdflib.namespace import DCAT, DCTERMS, FOAF, OWL, RDF, SKOS, VOID, XSD

from .config import (
    DATA_DUMP,
    DATASET_TITLE,
    DATASET_URI,
    DATASET_VERSION,
    DBO,
    DBR,
    LICENSE,
    MO,
    RESOURCE,
    SCHEMA,
    SPARQL_ENDPOINT,
    WD,
    bind_namespaces,
)
from .load import Crawl
from .translate import TitleRow

VOID_CLASS = URIRef(str(VOID) + "class")
PARTITIONS = (
    ("movie", MO.Movie),
    ("person", MO.Person),
    ("credit", MO.Credit),
    ("genre", MO.Genre),
    ("profession", MO.Profession),
)
LINK_TARGETS = (
    ("wikidata", "http://www.wikidata.org/", str(WD)),
    ("dbpedia", "http://dbpedia.org/", str(DBR)),
)


def build_void(*, data: Graph, links: Graph, crawl: Crawl, titles: dict[str, TitleRow], modified: datetime) -> Graph:
    graph = bind_namespaces(Graph())
    dataset = URIRef(DATASET_URI)
    graph.add((dataset, RDF.type, VOID.Dataset))
    graph.add((dataset, RDF.type, DCAT.Dataset))
    graph.add((dataset, DCTERMS.title, Literal(DATASET_TITLE, lang="en")))
    graph.add((dataset, DCTERMS.description, Literal(_description(crawl, titles), lang="en")))
    graph.add((dataset, DCTERMS.license, URIRef(LICENSE)))
    graph.add((dataset, DCTERMS.modified, Literal(modified.isoformat(), datatype=XSD.dateTime)))
    graph.add((dataset, OWL.versionInfo, Literal(DATASET_VERSION)))
    for source in crawl.sources:
        graph.add((dataset, DCTERMS.source, URIRef(source["url"])))
    graph.add((dataset, VOID.uriSpace, Literal(RESOURCE)))
    graph.add((dataset, VOID.sparqlEndpoint, URIRef(SPARQL_ENDPOINT)))
    graph.add((dataset, VOID.dataDump, URIRef(DATA_DUMP)))
    for vocabulary in (MO, SCHEMA, DBO, SKOS, FOAF):
        graph.add((dataset, VOID.vocabulary, URIRef(str(vocabulary))))
    movies = sorted(data.subjects(RDF.type, MO.Movie))
    if movies:
        graph.add((dataset, VOID.exampleResource, movies[0]))

    graph.add((dataset, VOID.triples, Literal(len(data) + len(links))))
    graph.add((dataset, VOID.entities, Literal(len(set(data.subjects(RDF.type, None))))))
    for key, cls in PARTITIONS:
        partition = URIRef(f"{DATASET_URI}/partition/{key}")
        graph.add((dataset, VOID.classPartition, partition))
        graph.add((partition, VOID_CLASS, cls))
        graph.add((partition, VOID.entities, Literal(len(set(data.subjects(RDF.type, cls))))))

    for key, target, prefix in LINK_TARGETS:
        triples = [(s, p, o) for s, p, o in links if str(o).startswith(prefix)]
        linkset = URIRef(f"{DATASET_URI}/linkset/{key}")
        target_uri = URIRef(target)
        graph.add((dataset, VOID.subset, linkset))
        graph.add((linkset, RDF.type, VOID.Linkset))
        graph.add((linkset, VOID.subjectsTarget, dataset))
        graph.add((linkset, VOID.objectsTarget, target_uri))
        graph.add((target_uri, RDF.type, VOID.Dataset))
        graph.add((linkset, VOID.triples, Literal(len(triples))))
        for predicate in sorted({p for _, p, _ in triples}):
            graph.add((linkset, VOID.linkPredicate, predicate))
    return graph


def _description(crawl: Crawl, titles: dict[str, TitleRow]) -> str:
    used = [titles[i] for i in crawl.movies if i in titles]
    machine = sum(1 for t in used if t.source == "machine")
    reviewed = sum(1 for t in used if t.source == "reviewed")
    return (
        f"Linked Open Data about {len(crawl.movies)} movies and {len(crawl.people)} people from the IMDb "
        f"non-commercial datasets, linked to Wikidata and DBpedia. English and Vietnamese titles were "
        f"translated with Claude Code ({machine} machine-translated, {reviewed} reviewed by a person)."
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python -m pytest tests/test_void.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add pipeline/void.py tests/test_void.py
git commit -m "feat: VoID/DCAT dataset description with computed statistics and linksets"
```

---

### Task 9: SHACL shapes and validation

**Files:**
- Create: `shapes/movie-shapes.ttl`, `pipeline/validate.py`
- Test: `tests/test_validate.py`

**Interfaces:**
- Consumes: `config.RESOURCE`, `config.SHAPES_PATH`, `config.ONTOLOGY_PATH`; graphs from `transform.build_data_graph` and `link.build_link_graph`.
- Produces: `ValidationResult(violations: list[str], warnings: list[str])` with property `conforms: bool`; `validate(ontology: Graph, data: Graph, links: Graph, shapes_path: Path = SHAPES_PATH) -> ValidationResult`.

- [ ] **Step 1: Write the failing tests**

`tests/test_validate.py`:
```python
import pytest
from rdflib import BNode, Graph, Literal, URIRef
from rdflib.namespace import OWL, RDFS

from pipeline.config import MO, ONTOLOGY_PATH
from pipeline.link import LinkRow, build_link_graph
from pipeline.transform import build_data_graph
from pipeline.translate import load_titles
from pipeline.uris import movie_uri, person_uri
from pipeline.validate import validate
from tests.conftest import FIXTURES

NOW = "2026-09-28T00:00:00Z"


@pytest.fixture(scope="module")
def ontology():
    return Graph().parse(ONTOLOGY_PATH)


@pytest.fixture
def graphs(crawl_a):
    data, _ = build_data_graph(crawl_a, load_titles(FIXTURES / "movie_titles.csv"))
    links, _ = build_link_graph(crawl_a, {"tt0000001": LinkRow("tt0000001", "Q50", "Alpha_Movie", NOW)}, {}, {}, {})
    return data, links


def test_fixture_conforms_with_translation_warnings(ontology, graphs):
    result = validate(ontology, *graphs)
    assert result.conforms, result.violations
    assert len(result.warnings) == 2  # tt0000003 has neither @en nor @vi
    assert all("tt0000003" in w for w in result.warnings)


def test_missing_imdb_id_is_a_violation(ontology, graphs):
    data, links = graphs
    data.remove((movie_uri("tt0000001"), MO.imdbId, None))
    result = validate(ontology, data, links)
    assert not result.conforms
    assert any("tt0000001" in v and "imdbId" in v for v in result.violations)


def test_rating_out_of_range_is_a_violation(ontology, graphs):
    data, links = graphs
    data.set((movie_uri("tt0000001"), MO.averageRating, Literal(11)))
    assert not validate(ontology, data, links).conforms


def test_two_vietnamese_labels_is_a_violation(ontology, graphs):
    data, links = graphs
    data.add((movie_uri("tt0000001"), RDFS.label, Literal("Phim khác", lang="vi")))
    assert not validate(ontology, data, links).conforms


def test_same_as_outside_wikidata_or_dbpedia_is_a_violation(ontology, graphs):
    data, links = graphs
    links.add((movie_uri("tt0000001"), OWL.sameAs, URIRef("http://example.org/alpha")))
    result = validate(ontology, data, links)
    assert any("example.org" in v for v in result.violations)


def test_untyped_reference_is_a_violation(ontology, graphs):
    data, links = graphs
    data.add((movie_uri("tt0000001"), MO.hasActor, person_uri("nm0999999")))
    result = validate(ontology, data, links)
    assert any("nm0999999" in v and "no rdf:type" in v for v in result.violations)


def test_blank_node_is_a_violation(ontology, graphs):
    data, links = graphs
    data.add((movie_uri("tt0000001"), MO.job, BNode()))
    assert any("blank node" in v for v in validate(ontology, data, links).violations)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_validate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.validate'`

- [ ] **Step 3: Write the shapes**

`shapes/movie-shapes.ttl`:
```turtle
@prefix sh:   <http://www.w3.org/ns/shacl#> .
@prefix mo:   <https://lod-movie.felix-nguyen.io.vn/ontology#> .
@prefix ms:   <https://lod-movie.felix-nguyen.io.vn/shapes#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

ms:MovieShape a sh:NodeShape ;
    sh:targetClass mo:Movie ;
    sh:property [
        sh:path rdfs:label ; sh:minCount 1 ; sh:uniqueLang true ;
        sh:message "A movie needs a label, and at most one label per language."
    ] , [
        sh:path mo:primaryTitle ; sh:minCount 1 ; sh:maxCount 1
    ] , [
        sh:path mo:imdbId ; sh:minCount 1 ; sh:maxCount 1 ; sh:pattern "^tt[0-9]+$"
    ] , [
        sh:path mo:releaseYear ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:integer
    ] , [
        sh:path mo:runtimeMinutes ; sh:maxCount 1 ; sh:datatype xsd:integer
    ] , [
        sh:path mo:numVotes ; sh:maxCount 1 ; sh:datatype xsd:integer
    ] , [
        sh:path mo:averageRating ; sh:maxCount 1 ; sh:datatype xsd:decimal ;
        sh:minInclusive 0 ; sh:maxInclusive 10
    ] , [
        sh:path mo:hasGenre ; sh:minCount 1 ; sh:class mo:Genre
    ] , [
        sh:path mo:directedBy ; sh:class mo:Person
    ] , [
        sh:path mo:hasActor ; sh:class mo:Person
    ] , [
        sh:path mo:writtenBy ; sh:class mo:Person
    ] , [
        sh:path mo:hasCredit ; sh:class mo:Credit
    ] .

ms:MovieTitleLanguagesShape a sh:NodeShape ;
    sh:targetClass mo:Movie ;
    sh:property [
        sh:path rdfs:label ; sh:severity sh:Warning ;
        sh:qualifiedValueShape [ sh:languageIn ( "en" ) ] ; sh:qualifiedMinCount 1 ;
        sh:message "Movie has no English (@en) title; add it to translations/movie_titles.csv."
    ] , [
        sh:path rdfs:label ; sh:severity sh:Warning ;
        sh:qualifiedValueShape [ sh:languageIn ( "vi" ) ] ; sh:qualifiedMinCount 1 ;
        sh:message "Movie has no Vietnamese (@vi) title; add it to translations/movie_titles.csv."
    ] .

ms:PersonShape a sh:NodeShape ;
    sh:targetClass mo:Person ;
    sh:property [
        sh:path rdfs:label ; sh:minCount 1 ; sh:maxCount 1
    ] , [
        sh:path mo:imdbId ; sh:minCount 1 ; sh:maxCount 1 ; sh:pattern "^nm[0-9]+$"
    ] , [
        sh:path mo:birthYear ; sh:maxCount 1 ; sh:datatype xsd:integer
    ] , [
        sh:path mo:deathYear ; sh:maxCount 1 ; sh:datatype xsd:integer
    ] , [
        sh:path mo:primaryProfession ; sh:class mo:Profession
    ] , [
        sh:path mo:knownFor ; sh:class mo:Movie
    ] .

ms:CreditShape a sh:NodeShape ;
    sh:targetClass mo:Credit ;
    sh:property [
        sh:path mo:creditedPerson ; sh:minCount 1 ; sh:maxCount 1 ; sh:class mo:Person
    ] , [
        sh:path mo:creditRole ; sh:minCount 1 ; sh:maxCount 1 ; sh:class mo:Profession
    ] , [
        sh:path mo:billingOrder ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:integer
    ] , [
        sh:path [ sh:inversePath mo:hasCredit ] ; sh:minCount 1 ; sh:maxCount 1 ; sh:class mo:Movie ;
        sh:message "A credit must belong to exactly one movie."
    ] .

ms:ConceptShape a sh:NodeShape ;
    sh:targetClass mo:Genre , mo:Profession ;
    sh:property [
        sh:path skos:prefLabel ; sh:minCount 1
    ] , [
        sh:path skos:inScheme ; sh:minCount 1 ; sh:maxCount 1
    ] .

ms:SameAsShape a sh:NodeShape ;
    sh:targetSubjectsOf owl:sameAs ;
    sh:property [
        sh:path owl:sameAs ; sh:nodeKind sh:IRI ;
        sh:pattern "^(http://www\\.wikidata\\.org/entity/Q[0-9]+|http://dbpedia\\.org/resource/.+)$" ;
        sh:message "owl:sameAs must point to a Wikidata entity or a DBpedia resource."
    ] .
```

- [ ] **Step 4: Write the implementation**

`pipeline/validate.py`:
```python
"""Quality gate: SHACL shapes plus referential and blank-node checks. Violations stop the build."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pyshacl
from rdflib import BNode, Graph, URIRef
from rdflib.namespace import RDF, SH

from .config import RESOURCE, SHAPES_PATH


@dataclass
class ValidationResult:
    violations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def conforms(self) -> bool:
        return not self.violations


def validate(ontology: Graph, data: Graph, links: Graph, shapes_path: Path = SHAPES_PATH) -> ValidationResult:
    combined = Graph()
    combined += data
    combined += links
    shapes = Graph().parse(shapes_path)
    _, report, _ = pyshacl.validate(combined, shacl_graph=shapes, ont_graph=ontology, inference="none")

    result = ValidationResult()
    for node in report.subjects(RDF.type, SH.ValidationResult):
        message = (
            f"{report.value(node, SH.focusNode)} {report.value(node, SH.resultPath)}: "
            f"{report.value(node, SH.resultMessage)} (value: {report.value(node, SH.value)})"
        )
        if report.value(node, SH.resultSeverity) == SH.Violation:
            result.violations.append(message)
        else:
            result.warnings.append(message)
    result.violations.extend(_reference_errors(data, links))
    result.violations.sort()
    result.warnings.sort()
    return result


def _reference_errors(data: Graph, links: Graph) -> list[str]:
    typed = set(data.subjects(RDF.type, None))
    errors = set()
    for graph in (data, links):
        for s, p, o in graph:
            for term in (s, o):
                if isinstance(term, BNode):
                    errors.add(f"blank node in ({s} {p} {o})")
                elif isinstance(term, URIRef) and str(term).startswith(RESOURCE) and term not in typed:
                    errors.add(f"{term}: referenced but has no rdf:type")
    return sorted(errors)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_validate.py -v`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add shapes pipeline/validate.py tests/test_validate.py
git commit -m "feat: SHACL shapes and validation gate"
```

---

### Task 10: Build CLI

**Files:**
- Create: `pipeline/build.py`, `pipeline/__main__.py`
- Test: `tests/test_build.py`

**Interfaces:**
- Consumes: everything above: `load_crawl`, `load_titles`, `build_data_graph`, `WikidataClient`, `load_link_store`, `save_link_store`, `resolve_links`, `load_mappings`, `build_link_graph`, `build_void`, `validate`, `config.*`.
- Produces: `run_build(*, inputs, out=DIST_DIR, links_dir=LINKS_DIR, mappings_dir=MAPPINGS_DIR, titles_path=TITLES_PATH, ontology_path=ONTOLOGY_PATH, shapes_path=SHAPES_PATH, refresh=False, offline=False, client=None, now: datetime|None=None) -> int` (0 ok, 1 validation failed, 2 too many bad rows); `main(argv=None) -> int`.

- [ ] **Step 1: Write the failing tests**

`tests/test_build.py`:
```python
import gzip
import json
import shutil
from datetime import datetime, timezone

import pytest
from rdflib import Graph

from pipeline.build import run_build
from pipeline.link import LinkRow, load_link_store, save_link_store
from tests.conftest import FIXTURES
from tests.fakes import FakeClient

NOW = datetime(2026, 9, 28, tzinfo=timezone.utc)
CHECKED = "2026-09-28T00:00:00Z"


@pytest.fixture
def links_dir(tmp_path):
    folder = tmp_path / "links"
    save_link_store(folder / "movies.csv", {"tt0000001": LinkRow("tt0000001", "Q50", "Alpha_Movie", CHECKED)})
    save_link_store(folder / "people.csv", {})
    return folder


def build(tmp_path, links_dir, inputs=None, out_name="dist", **kwargs):
    kwargs.setdefault("offline", True)
    return run_build(
        inputs=inputs or [FIXTURES / "crawl_a"],
        out=tmp_path / out_name,
        links_dir=links_dir,
        mappings_dir=FIXTURES / "mappings",
        titles_path=FIXTURES / "movie_titles.csv",
        now=NOW,
        **kwargs,
    )


def test_offline_build_writes_all_outputs(tmp_path, links_dir):
    assert build(tmp_path, links_dir) == 0
    out = tmp_path / "dist"
    names = {"ontology.ttl", "data.nt", "links.nt", "void.ttl", "all.ttl.gz", "link_report.json", "build_report.json"}
    assert {p.name for p in out.iterdir()} == names
    data = (out / "data.nt").read_text(encoding="utf-8")
    assert '<https://lod-movie.felix-nguyen.io.vn/resource/movie/tt0000001> <http://www.w3.org/2000/01/rdf-schema#label> "Phim Alpha"@vi .' in data
    assert "http://www.wikidata.org/entity/Q50" in (out / "links.nt").read_text(encoding="utf-8")
    report = json.loads((out / "build_report.json").read_text(encoding="utf-8"))
    assert report["counts"] == {"movies": 3, "people": 3, "credits": 5, "genres": 4, "professions": 5}
    assert any("offline" in w for w in report["warnings"])
    combined = Graph().parse(data=gzip.decompress((out / "all.ttl.gz").read_bytes()).decode("utf-8"), format="turtle")
    assert len(combined) == sum(report["triples"].values())
    link_report = json.loads((out / "link_report.json").read_text(encoding="utf-8"))
    assert link_report["movies"]["wikidata"] == 1


def test_online_build_queries_only_unchecked_ids_and_saves_store(tmp_path, links_dir):
    client = FakeClient({"nm0000001": [("Q200", "Ann_Actor")]})
    assert build(tmp_path, links_dir, offline=False, client=client) == 0
    assert client.batches == [["tt0000002", "tt0000003"], ["nm0000001", "nm0000002", "nm0000003"]]
    assert load_link_store(links_dir / "people.csv")["nm0000001"].wikidata_qid == "Q200"


def test_rebuild_is_deterministic(tmp_path, links_dir):
    assert build(tmp_path, links_dir, out_name="one") == 0
    assert build(tmp_path, links_dir, out_name="two") == 0
    for name in ("data.nt", "links.nt", "all.ttl.gz"):
        assert (tmp_path / "one" / name).read_bytes() == (tmp_path / "two" / name).read_bytes(), name
    assert b"\r\n" not in (tmp_path / "one" / "data.nt").read_bytes()


def test_growth_keeps_existing_triples(tmp_path, links_dir):
    assert build(tmp_path, links_dir, out_name="a") == 0
    assert build(tmp_path, links_dir, inputs=[FIXTURES / "crawl_a", FIXTURES / "crawl_b"], out_name="ab") == 0
    for name in ("data.nt", "links.nt"):
        before = set((tmp_path / "a" / name).read_text(encoding="utf-8").splitlines())
        after = set((tmp_path / "ab" / name).read_text(encoding="utf-8").splitlines())
        assert before <= after, name
    report = json.loads((tmp_path / "ab" / "build_report.json").read_text(encoding="utf-8"))
    assert report["counts"]["movies"] == 5


def test_failed_validation_leaves_dist_untouched(tmp_path, links_dir):
    crawl = tmp_path / "crawl"
    shutil.copytree(FIXTURES / "crawl_a", crawl)
    with (crawl / "movie_people.csv").open("a", encoding="utf-8") as f:
        f.write('tt0000001,nm0999999,actor,"[]"\n')
    out = tmp_path / "dist"
    out.mkdir()
    (out / "marker.txt").write_text("previous good build", encoding="utf-8")
    assert build(tmp_path, links_dir, inputs=[crawl]) == 1
    assert (out / "marker.txt").exists()
    assert not (tmp_path / "dist.tmp").exists()


def test_too_many_bad_rows_stops_the_build(tmp_path, links_dir):
    crawl = tmp_path / "crawl"
    shutil.copytree(FIXTURES / "crawl_a", crawl)
    with (crawl / "movies.csv").open("a", encoding="utf-8") as f:
        f.write("tt0000009,Bad,Bad,movie,False,nineteen,,90,5.0,10,[],[],x\n")
    assert build(tmp_path, links_dir, inputs=[crawl]) == 2
    assert not (tmp_path / "dist").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_build.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.build'`

- [ ] **Step 3: Write the implementation**

`pipeline/build.py`:
```python
"""Build the LOD Movie dataset: load -> transform -> link -> describe -> validate -> write dist/."""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from rdflib import Graph

from .config import (
    BAD_ROW_THRESHOLD,
    DEFAULT_INPUT,
    DIST_DIR,
    LINKS_DIR,
    MAPPINGS_DIR,
    ONTOLOGY_PATH,
    SHAPES_PATH,
    TITLES_PATH,
    bind_namespaces,
    utf8_stdout,
)
from .link import (
    WikidataClient,
    build_link_graph,
    load_link_store,
    load_mappings,
    resolve_links,
    save_link_store,
)
from .load import load_crawl
from .transform import build_data_graph
from .translate import load_titles
from .validate import validate
from .void import build_void


def run_build(
    *,
    inputs: list[Path],
    out: Path = DIST_DIR,
    links_dir: Path = LINKS_DIR,
    mappings_dir: Path = MAPPINGS_DIR,
    titles_path: Path = TITLES_PATH,
    ontology_path: Path = ONTOLOGY_PATH,
    shapes_path: Path = SHAPES_PATH,
    refresh: bool = False,
    offline: bool = False,
    client=None,
    now: datetime | None = None,
) -> int:
    started = time.perf_counter()
    now = now or datetime.now(timezone.utc).replace(microsecond=0)

    crawl = load_crawl(inputs)
    if crawl.bad_row_ratio > BAD_ROW_THRESHOLD:
        print(f"Too many malformed rows: {crawl.rows_bad}/{crawl.rows_read} (limit {BAD_ROW_THRESHOLD:.0%})")
        for warning in crawl.warnings[:20]:
            print(f"  {warning}")
        return 2

    titles = load_titles(titles_path)
    data, transform_warnings = build_data_graph(crawl, titles)

    movie_store = load_link_store(links_dir / "movies.csv")
    person_store = load_link_store(links_dir / "people.csv")
    if not offline and client is None:
        client = WikidataClient(cache_dir=links_dir / "cache")
    active_client = None if offline else client
    link_warnings = resolve_links(crawl.movies.keys(), movie_store, active_client, refresh=refresh)
    link_warnings += resolve_links(crawl.people.keys(), person_store, active_client, refresh=refresh)
    if not offline:
        save_link_store(links_dir / "movies.csv", movie_store)
        save_link_store(links_dir / "people.csv", person_store)

    links, link_report = build_link_graph(
        crawl,
        movie_store,
        person_store,
        load_mappings(mappings_dir / "genres.csv"),
        load_mappings(mappings_dir / "professions.csv"),
    )
    for kind in ("genres", "professions"):
        if link_report[kind]["unmapped"]:
            link_warnings.append(f"unmapped {kind}: {', '.join(link_report[kind]['unmapped'])}")

    ontology = Graph().parse(ontology_path)
    void = build_void(data=data, links=links, crawl=crawl, titles=titles, modified=now)
    result = validate(ontology, data, links, shapes_path)
    if not result.conforms:
        print(f"Validation failed with {len(result.violations)} violation(s); {out} left unchanged.")
        for violation in result.violations[:20]:
            print(f"  {violation}")
        return 1

    warnings = crawl.warnings + transform_warnings + link_warnings + result.warnings
    build_report = {
        "built_at": now.isoformat(),
        "inputs": [str(p) for p in inputs],
        "counts": {
            "movies": len(crawl.movies),
            "people": len(crawl.people),
            "credits": len(crawl.credits),
            "genres": len(crawl.genres),
            "professions": len(crawl.professions),
        },
        "triples": {"ontology": len(ontology), "data": len(data), "links": len(links), "void": len(void)},
        "rows_read": crawl.rows_read,
        "rows_bad": crawl.rows_bad,
        "warnings": warnings,
    }
    _write_outputs(out, ontology_path, ontology, data, links, void, link_report, build_report)
    _print_summary(out, build_report, link_report, time.perf_counter() - started)
    return 0


def _write_outputs(out: Path, ontology_path: Path, ontology: Graph, data: Graph, links: Graph,
                   void: Graph, link_report: dict, build_report: dict) -> None:
    tmp = out.with_name(out.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    shutil.copyfile(ontology_path, tmp / "ontology.ttl")
    _write_ntriples(data, tmp / "data.nt")
    _write_ntriples(links, tmp / "links.nt")
    (tmp / "void.ttl").write_text(void.serialize(format="turtle"), encoding="utf-8", newline="\n")

    combined = bind_namespaces(Graph())
    for graph in (ontology, data, links, void):
        combined += graph
    with gzip.GzipFile(tmp / "all.ttl.gz", "wb", mtime=0) as f:
        f.write(combined.serialize(format="turtle").encode("utf-8"))

    for name, report in (("link_report.json", link_report), ("build_report.json", build_report)):
        (tmp / name).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    if out.exists():
        shutil.rmtree(out)
    tmp.rename(out)


def _write_ntriples(graph: Graph, path: Path) -> None:
    lines = sorted(line for line in graph.serialize(format="nt").splitlines() if line.strip())
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def _print_summary(out: Path, report: dict, links: dict, seconds: float) -> None:
    counts, triples = report["counts"], report["triples"]
    print(f"Built {out} in {seconds:.1f}s")
    print(f"  movies {counts['movies']} | people {counts['people']} | credits {counts['credits']}")
    print(f"  triples: data {triples['data']} | links {triples['links']} | ontology {triples['ontology']} | void {triples['void']}")
    for kind in ("movies", "people"):
        r = links[kind]
        print(f"  {kind}: {r['wikidata']}/{r['total']} linked to Wikidata ({r['wikidata_pct']}%), {r['dbpedia']} to DBpedia")
    for kind in ("genres", "professions"):
        print(f"  {kind}: {links[kind]['mapped']}/{links[kind]['total']} mapped")
    print(f"  warnings: {len(report['warnings'])} (see {out / 'build_report.json'})")


def main(argv: list[str] | None = None) -> int:
    utf8_stdout()
    parser = argparse.ArgumentParser(prog="python -m pipeline.build", description=__doc__)
    parser.add_argument("--input", action="append", type=Path, help="crawl folder (repeatable; default: data/)")
    parser.add_argument("--out", type=Path, default=DIST_DIR, help="output folder (default: dist/)")
    parser.add_argument("--refresh", action="store_true", help="re-check every IMDb ID against Wikidata")
    parser.add_argument("--offline", action="store_true", help="do not contact Wikidata; use the committed link store")
    args = parser.parse_args(argv)
    return run_build(inputs=args.input or [DEFAULT_INPUT], out=args.out, refresh=args.refresh, offline=args.offline)


if __name__ == "__main__":
    raise SystemExit(main())
```

`pipeline/__main__.py`:
```python
from .build import main

raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_build.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the whole suite**

Run: `.venv/Scripts/python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add pipeline/build.py pipeline/__main__.py tests/test_build.py
git commit -m "feat: build CLI with atomic dist/ output and summary"
```

---

### Task 11: Real genre and profession mappings

**Files:**
- Create: `mappings/genres.csv`, `mappings/professions.csv`
- Scratch (not committed): `<scratchpad>/check_mappings.py`

**Interfaces:**
- Consumes: `link.load_mappings` format (`source_value,wikidata_qid,dbpedia_resource,match_type`).

- [ ] **Step 1: Write the candidate mappings**

`mappings/genres.csv` (19 IMDb genres):
```
source_value,wikidata_qid,dbpedia_resource,match_type
Action,Q188473,,exact
Adventure,Q319221,,exact
Animation,Q202866,,exact
Biography,Q645928,,exact
Comedy,Q157443,,exact
Crime,Q959790,,exact
Drama,Q130232,,exact
Family,Q1361932,,exact
Fantasy,Q1342372,,exact
History,Q17013749,,exact
Horror,Q200092,,exact
Music,Q842256,,close
Musical,Q842256,,exact
Mystery,Q1200678,,exact
Romance,Q1054574,,exact
Sci-Fi,Q471839,,exact
Sport,Q1146335,,exact
Thriller,Q2484376,,exact
War,Q369747,,exact
```

`mappings/professions.csv` (roles with a clear Wikidata occupation; vague IMDb buckets such as `miscellaneous`, `*_department`, `archive_footage`, `self`, `soundtrack` are listed with an empty QID = deliberately unmapped):
```
source_value,wikidata_qid,dbpedia_resource,match_type
actor,Q33999,,exact
actress,Q33999,,close
art_director,Q706364,,exact
assistant_director,Q1757008,,exact
casting_director,Q1049296,,exact
choreographer,Q2490358,,exact
cinematographer,Q222344,,exact
composer,Q1415090,,close
costume_designer,Q1323191,,exact
director,Q2526255,,exact
editor,Q7042855,,exact
make_up_department,Q935666,,close
music_artist,Q639669,,close
producer,Q3282637,,exact
production_designer,Q2962070,,exact
stunts,Q465501,,close
writer,Q28389,,close
archive_footage,,,
archive_sound,,,
miscellaneous,,,
self,,,
soundtrack,,,
```

- [ ] **Step 2: Verify every QID against Wikidata and fill `dbpedia_resource`**

Create `<scratchpad>/check_mappings.py`:
```python
"""Print label + English Wikipedia title for each mapped QID, and fill dbpedia_resource in place."""
import csv
import sys
from pathlib import Path
from urllib.parse import unquote

import requests

UA = "lod-movie-capstone/1.0 (https://lod-movie.felix-nguyen.io.vn/; semantic-web student project)"
QUERY = """SELECT ?item ?label ?article WHERE {
  VALUES ?item { %s }
  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
}"""

for path in map(Path, sys.argv[1:]):
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    qids = sorted({r["wikidata_qid"] for r in rows if r["wikidata_qid"]})
    resp = requests.post("https://query.wikidata.org/sparql",
                         data={"query": QUERY % " ".join(f"wd:{q}" for q in qids)},
                         headers={"User-Agent": UA, "Accept": "application/sparql-results+json"}, timeout=60)
    resp.raise_for_status()
    info = {}
    for b in resp.json()["results"]["bindings"]:
        qid = b["item"]["value"].rsplit("/", 1)[1]
        article = unquote(b["article"]["value"].split("/wiki/", 1)[1]) if "article" in b else ""
        info[qid] = (b["label"]["value"], article)
    for r in rows:
        if r["wikidata_qid"]:
            label, article = info.get(r["wikidata_qid"], ("<NOT FOUND>", ""))
            print(f"{path.name}: {r['source_value']:22} {r['wikidata_qid']:10} {label!r:35} {article}")
            r["dbpedia_resource"] = article
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["source_value", "wikidata_qid", "dbpedia_resource", "match_type"], lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
```

Run: `.venv/Scripts/python <scratchpad>/check_mappings.py mappings/genres.csv mappings/professions.csv`
Expected: one line per mapped row. For each row whose label does not describe the IMDb value (e.g. a QID that is not "sports film" for `Sport`), find the right item by querying Wikidata for the English label (e.g. `SELECT ?i WHERE { ?i rdfs:label "sports film"@en }`), fix the QID, and re-run until every label matches. Remove a row's QID (leave it empty) if no suitable item exists.

- [ ] **Step 3: Check the mappings load**

Run: `.venv/Scripts/python -c "from pipeline.link import load_mappings; from pipeline.config import MAPPINGS_DIR as M; print(len(load_mappings(M/'genres.csv')), len(load_mappings(M/'professions.csv')))"`
Expected: `19 17` (or fewer if a QID was dropped in Step 2)

- [ ] **Step 4: Commit**

```bash
git add mappings
git commit -m "data: hand-checked genre and profession mappings to Wikidata/DBpedia"
```

---

### Task 12: Translate the titles, link, build the real dataset and document it

**Files:**
- Create: `translations/movie_titles.csv`, `links/movies.csv`, `links/people.csv`, `dist/*`, `README.md`

- [ ] **Step 1: Produce the translation worklist**

Run: `.venv/Scripts/python -m pipeline.translate --todo`
Expected: `300 movie(s) need titles -> ...translations\todo.csv`

- [ ] **Step 2: Claude Code translates the worklist**

Claude Code reads `translations/todo.csv` and fills `title_en` and `title_vi` for every row, following spec §5a rules: use the well-known official English / Vietnamese release title when one exists, otherwise a natural (not word-for-word) translation; keep proper names; `title_en` equals `primary_title` when that is already English; Vietnamese with proper diacritics. Work in chunks of ~50 rows; write the file back as UTF-8 with the same header.

- [ ] **Step 3: Merge the translations**

Run: `.venv/Scripts/python -m pipeline.translate --merge`
Expected: `merged 300 title(s) into ...movie_titles.csv` and exit code 0. Fix and re-run for any rejected rows.

- [ ] **Step 4: Run the real build (online; ~30 Wikidata batches)**

Run: `.venv/Scripts/python -m pipeline.build`
Expected: exit code 0 and a summary like:
```
Built ...\dist in NN.Ns
  movies 300 | people 5476 | credits 6204
  triples: data ~110000 | links ~9000 | ontology ~250 | void ~50
  movies: ~29x/300 linked to Wikidata (9x%) ...
```
If validation fails, read the printed violations, fix the cause (never loosen a shape to hide real data errors), and re-run.

- [ ] **Step 5: Verify offline rebuild reproduces the same data**

Run:
```bash
cp dist/data.nt /tmp/data-before.nt 2>/dev/null || cp dist/data.nt "$TEMP/data-before.nt"
.venv/Scripts/python -m pipeline.build --offline
cmp dist/data.nt "$TEMP/data-before.nt" && echo SAME
```
Expected: `SAME`

- [ ] **Step 6: Spot-check with SPARQL**

Run:
```bash
.venv/Scripts/python - <<'EOF'
import gzip
from rdflib import Graph
g = Graph().parse(data=gzip.decompress(open("dist/all.ttl.gz", "rb").read()).decode("utf-8"), format="turtle")
q = """PREFIX mo: <https://lod-movie.felix-nguyen.io.vn/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT ?en ?vi ?year ?wd WHERE {
  ?m a mo:Movie ; mo:releaseYear ?year ; rdfs:label ?en , ?vi .
  FILTER(LANG(?en) = "en" && LANG(?vi) = "vi")
  OPTIONAL { ?m owl:sameAs ?wd FILTER(STRSTARTS(STR(?wd), "http://www.wikidata.org/")) }
} ORDER BY DESC(?year) LIMIT 5"""
for row in g.query(q):
    print(*row, sep=" | ")
EOF
```
Expected: five rows with English title, Vietnamese title, year and a Wikidata IRI.

- [ ] **Step 7: Write the README**

`README.md`:
````markdown
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
````

- [ ] **Step 8: Run the full test suite and commit**

Run: `.venv/Scripts/python -m pytest -q`
Expected: all tests pass.

```bash
git add translations/movie_titles.csv links/movies.csv links/people.csv dist README.md
git commit -m "data: bilingual titles, Wikidata link store and first 5-star build"
```
