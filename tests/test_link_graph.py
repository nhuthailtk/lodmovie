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
