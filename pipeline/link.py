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
from rdflib import Graph, URIRef
from rdflib.namespace import OWL, SKOS

from .config import (
    DBR,
    USER_AGENT,
    WD,
    WIKIDATA_BATCH_SIZE,
    WIKIDATA_ENDPOINT,
    WIKIDATA_PAUSE_SECONDS,
    bind_namespaces,
)
from .load import Crawl
from .uris import genre_uri, movie_uri, person_uri, profession_uri

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
        try:
            bindings = data["results"]["bindings"]
        except (KeyError, TypeError):
            raise WikidataError(f"unexpected response: {str(data)[:200]}") from None
        result: dict[str, list[tuple[str, str]]] = {}
        for binding in bindings:
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
                    try:
                        return response.json()
                    except ValueError:
                        raise WikidataError(f"response is not JSON: {response.text[:200]}") from None
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


MAPPING_FIELDS = ["source_value", "wikidata_qid", "dbpedia_resource", "match_type"]
MATCH_PREDICATE = {"exact": SKOS.exactMatch, "close": SKOS.closeMatch, "broad": SKOS.broadMatch}


@dataclass(frozen=True)
class Mapping:
    source_value: str
    wikidata_qid: str
    dbpedia_resource: str  # English Wikipedia / DBpedia title, may be empty
    match_type: str  # "exact", "close" or "broad"


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
                raise ValueError(f"{path}: {mapping.source_value}: match_type must be exact, close or broad")
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
