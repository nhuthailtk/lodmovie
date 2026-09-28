from datetime import datetime, timezone

import pytest
from rdflib import Literal, URIRef
from rdflib.namespace import DCAT, DCTERMS, RDF, VOID

from pipeline.config import MO
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
