"""English/Vietnamese movie titles: the title store, a worklist for Claude Code, and a validated merge.

Workflow for movies without titles:
    python -m pipeline.translate --todo    # writes translations/todo.csv
    (Claude Code fills in title_en and title_vi in todo.csv)
    python -m pipeline.translate --merge   # validates and merges into translations/movie_titles.csv

movie_titles.csv is only the source store. pipeline.transform writes each title into the RDF as
rdfs:label and schema:name with @en and @vi tags, so the final .ttl must be rebuilt after a merge.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

from .config import DEFAULT_INPUT, TITLES_PATH, TODO_PATH, utf8_stdout
from .load import Crawl, Movie, load_crawl

FIELDS = ["imdb_id", "primary_title", "title_en", "title_vi", "source", "translated_at"]
TODO_FIELDS = ["imdb_id", "primary_title", "original_title", "year", "genres", "title_en", "title_vi"]
SOURCES = ("machine", "reviewed")


@dataclass(frozen=True)
class TitleRow:
    imdb_id: str
    primary_title: str
    title_en: str
    title_vi: str
    source: str  # "machine" (translated by Claude Code) or "reviewed" (checked by a person)
    translated_at: str


def load_titles(path: Path) -> dict[str, TitleRow]:
    if not path.exists():
        return {}
    rows: dict[str, TitleRow] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for raw in csv.DictReader(f):
            row = TitleRow(**{key: (raw.get(key) or "").strip() for key in FIELDS})
            if row.source not in SOURCES:
                raise ValueError(f"{path}: {row.imdb_id}: source must be one of {SOURCES}, got {row.source!r}")
            for key in ("title_en", "title_vi"):
                if not getattr(row, key):
                    raise ValueError(f"{path}: {row.imdb_id}: {key} is empty")
            rows[row.imdb_id] = row
    return rows


def save_titles(path: Path, rows: dict[str, TitleRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        for imdb_id in sorted(rows):
            writer.writerow(asdict(rows[imdb_id]))


def needs_translation(crawl: Crawl, titles: dict[str, TitleRow]) -> list[Movie]:
    """Movies with no title row, or whose IMDb title changed since a machine translation."""
    result = []
    for imdb_id in sorted(crawl.movies):
        movie = crawl.movies[imdb_id]
        row = titles.get(imdb_id)
        if row is None or (row.source != "reviewed" and row.primary_title != movie.primary_title):
            result.append(movie)
    return result


def write_todo(path: Path, crawl: Crawl, movies: list[Movie]) -> None:
    genres: dict[str, list[str]] = {}
    for imdb_id, genre in crawl.movie_genres:
        genres.setdefault(imdb_id, []).append(genre)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=TODO_FIELDS, lineterminator="\n")
        writer.writeheader()
        for movie in movies:
            writer.writerow({
                "imdb_id": movie.imdb_id,
                "primary_title": movie.primary_title,
                "original_title": movie.original_title or "",
                "year": movie.release_year or "",
                "genres": ", ".join(sorted(genres.get(movie.imdb_id, []))),
                "title_en": "",
                "title_vi": "",
            })


def merge_todo(path: Path, titles: dict[str, TitleRow], crawl: Crawl, today: str) -> tuple[int, list[str]]:
    """Merge filled-in worklist rows into `titles`; returns (merged count, rejection messages)."""
    merged, errors, seen = 0, [], set()
    with path.open(encoding="utf-8-sig", newline="") as f:
        for line, raw in enumerate(csv.DictReader(f), start=2):
            imdb_id = (raw.get("imdb_id") or "").strip()
            title_en = (raw.get("title_en") or "").strip()
            title_vi = (raw.get("title_vi") or "").strip()
            existing = titles.get(imdb_id)
            if imdb_id in seen:
                problem = "duplicate imdb_id in worklist"
            elif imdb_id not in crawl.movies:
                problem = "unknown imdb_id"
            elif not title_en or not title_vi:
                problem = "title_en and title_vi are required"
            elif existing is not None and existing.source == "reviewed":
                problem = "reviewed title is never overwritten"
            else:
                problem = None
            seen.add(imdb_id)
            if problem:
                errors.append(f"{path.name}:{line} {imdb_id or '?'}: {problem}")
                continue
            titles[imdb_id] = TitleRow(
                imdb_id, crawl.movies[imdb_id].primary_title, title_en, title_vi, "machine", today
            )
            merged += 1
    return merged, errors


def main(argv: list[str] | None = None) -> int:
    utf8_stdout()
    parser = argparse.ArgumentParser(prog="python -m pipeline.translate", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--todo", action="store_true", help="write the worklist of movies that need titles")
    mode.add_argument("--merge", action="store_true", help="validate the worklist and merge it into the title store")
    parser.add_argument("--input", action="append", type=Path, help="crawl folder (repeatable; default: data/)")
    parser.add_argument("--titles", type=Path, default=TITLES_PATH, help="title store CSV")
    parser.add_argument("--todo-file", type=Path, default=TODO_PATH, help="worklist CSV")
    args = parser.parse_args(argv)

    crawl = load_crawl(args.input or [DEFAULT_INPUT])
    titles = load_titles(args.titles)
    if args.todo:
        movies = needs_translation(crawl, titles)
        write_todo(args.todo_file, crawl, movies)
        print(f"{len(movies)} movie(s) need titles -> {args.todo_file}")
        return 0
    merged, errors = merge_todo(args.todo_file, titles, crawl, date.today().isoformat())
    save_titles(args.titles, titles)
    print(f"merged {merged} title(s) into {args.titles}")
    for error in errors:
        print(f"  rejected {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
