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
    composer = profession_uri("composer")
    assert (composer, RDF.type, MO.Profession) in g
    assert (composer, SKOS.prefLabel, Literal("composer", lang="en")) in g


def test_no_blank_nodes(g):
    assert not any(isinstance(term, BNode) for triple in g for term in triple)


def test_only_declared_ontology_terms_are_used(g):
    onto = Graph().parse(ONTOLOGY_PATH)
    declared = {s for kind in (OWL.Class, OWL.ObjectProperty, OWL.DatatypeProperty)
                for s in onto.subjects(RDF.type, kind)}
    used = {p for p in g.predicates() if str(p).startswith(str(MO))}
    used |= {o for o in g.objects(None, RDF.type) if str(o).startswith(str(MO))}
    assert used - declared == set()
