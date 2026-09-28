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
