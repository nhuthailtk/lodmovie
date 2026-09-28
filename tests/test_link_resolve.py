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
