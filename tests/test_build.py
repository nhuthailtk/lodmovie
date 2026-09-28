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
