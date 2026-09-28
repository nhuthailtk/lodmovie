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
