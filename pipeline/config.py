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
