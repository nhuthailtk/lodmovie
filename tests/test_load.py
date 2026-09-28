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
