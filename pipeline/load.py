"""Load one or more IMDb crawl folders into typed, de-duplicated records."""

from __future__ import annotations

import csv
import json
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROLES = ("actor", "director", "writer")


class RowError(ValueError):
    """A CSV row that cannot be used."""


@dataclass(frozen=True)
class Movie:
    imdb_id: str
    primary_title: str
    original_title: str | None
    release_year: int | None
    runtime_minutes: int | None
    average_rating: Decimal | None
    num_votes: int | None


@dataclass(frozen=True)
class Person:
    person_id: str
    name: str
    birth_year: int | None
    death_year: int | None
    professions: tuple[str, ...]
    known_for: tuple[str, ...]


@dataclass(frozen=True)
class Credit:
    imdb_id: str
    ordering: int
    person_id: str
    category: str
    job: str | None
    characters: tuple[str, ...]


@dataclass
class Crawl:
    movies: dict[str, Movie] = field(default_factory=dict)
    people: dict[str, Person] = field(default_factory=dict)
    credits: dict[tuple[str, int], Credit] = field(default_factory=dict)
    genres: dict[str, bool] = field(default_factory=dict)  # genre name -> is a sampled target genre
    movie_genres: set[tuple[str, str]] = field(default_factory=set)
    movie_people: set[tuple[str, str, str]] = field(default_factory=set)  # (movie, person, role)
    sampling: set[tuple[str, str]] = field(default_factory=set)
    sources: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    rows_read: int = 0
    rows_bad: int = 0

    @property
    def bad_row_ratio(self) -> float:
        return self.rows_bad / self.rows_read if self.rows_read else 0.0

    @property
    def professions(self) -> set[str]:
        values = {p for person in self.people.values() for p in person.professions}
        return values | {credit.category for credit in self.credits.values()}


def load_crawl(dirs: Iterable[Path]) -> Crawl:
    """Read every crawl folder in order; later folders win on conflicting values."""
    crawl = Crawl()
    for folder in dirs:
        _load_dir(Path(folder), crawl)
    for _, genre in sorted(crawl.movie_genres | crawl.sampling):
        crawl.genres.setdefault(genre, False)
    return crawl


def _load_dir(folder: Path, crawl: Crawl) -> None:
    _load_manifest(folder / "manifest.json", crawl)

    def movie(row: dict) -> None:
        record = Movie(
            imdb_id=_imdb_id(row, "imdb_id", "tt"),
            primary_title=_required(row, "primary_title"),
            original_title=_text(row, "original_title"),
            release_year=_int(row, "start_year"),
            runtime_minutes=_int(row, "runtime_minutes"),
            average_rating=_decimal(row, "average_rating"),
            num_votes=_int(row, "num_votes"),
        )
        _merge(crawl, crawl.movies, record.imdb_id, record, "movie")

    def person(row: dict) -> None:
        person_id = _imdb_id(row, "person_id", "nm")
        name = _text(row, "primary_name")
        if name is None:
            if not _bool(row, "name_record_missing"):
                raise RowError("missing primary_name")
            crawl.warnings.append(f"person {person_id}: IMDb has no name record, using the ID as name")
            name = person_id
        record = Person(
            person_id=person_id,
            name=name,
            birth_year=_int(row, "birth_year"),
            death_year=_int(row, "death_year"),
            professions=_json_list(row, "primary_professions"),
            known_for=_json_list(row, "known_for_title_ids"),
        )
        _merge(crawl, crawl.people, person_id, record, "person")

    def genre(row: dict) -> None:
        name = _required(row, "genre")
        crawl.genres[name] = crawl.genres.get(name, False) or _bool(row, "is_target_category")

    def movie_genre(row: dict) -> None:
        crawl.movie_genres.add((_imdb_id(row, "imdb_id", "tt"), _required(row, "genre")))

    def movie_person(row: dict) -> None:
        role = _required(row, "role")
        if role not in ROLES:
            raise RowError(f"unknown role {role!r}")
        crawl.movie_people.add((_imdb_id(row, "imdb_id", "tt"), _imdb_id(row, "person_id", "nm"), role))

    def credit(row: dict) -> None:
        ordering = _int(row, "ordering")
        if ordering is None:
            raise RowError("missing ordering")
        record = Credit(
            imdb_id=_imdb_id(row, "imdb_id", "tt"),
            ordering=ordering,
            person_id=_imdb_id(row, "person_id", "nm"),
            category=_required(row, "category"),
            job=_text(row, "job"),
            characters=_json_list(row, "characters"),
        )
        _merge(crawl, crawl.credits, (record.imdb_id, record.ordering), record, "credit")

    def sample(row: dict) -> None:
        crawl.sampling.add((_imdb_id(row, "imdb_id", "tt"), _required(row, "sample_category")))

    for filename, handler in (
        ("movies.csv", movie),
        ("people.csv", person),
        ("genres.csv", genre),
        ("movie_genres.csv", movie_genre),
        ("movie_people.csv", movie_person),
        ("principal_credits.csv", credit),
        ("sampling.csv", sample),
    ):
        _each_row(folder / filename, crawl, handler)


def _load_manifest(path: Path, crawl: Crawl) -> None:
    if not path.exists():
        crawl.warnings.append(f"{path}: not found, skipped")
        return
    known = {source["url"] for source in crawl.sources}
    for source in json.loads(path.read_text(encoding="utf-8-sig")).get("sources", []):
        url = source.get("url")
        if url and url not in known:
            crawl.sources.append(source)
            known.add(url)


def _each_row(path: Path, crawl: Crawl, handle: Callable[[dict], None]) -> None:
    if not path.exists():
        crawl.warnings.append(f"{path}: not found, skipped")
        return
    with path.open(encoding="utf-8-sig", newline="") as f:
        for line, row in enumerate(csv.DictReader(f), start=2):
            crawl.rows_read += 1
            try:
                handle(row)
            except RowError as exc:
                crawl.rows_bad += 1
                crawl.warnings.append(f"{path.name}:{line}: skipped ({exc})")


def _merge(crawl: Crawl, table: dict, key, value, what: str) -> None:
    old = table.get(key)
    if old is not None and old != value:
        crawl.warnings.append(f"{what} {key}: conflicting values across inputs, later input wins")
    table[key] = value


def _text(row: dict, key: str) -> str | None:
    value = (row.get(key) or "").strip()
    return value or None


def _required(row: dict, key: str) -> str:
    value = _text(row, key)
    if value is None:
        raise RowError(f"missing {key}")
    return value


def _imdb_id(row: dict, key: str, prefix: str) -> str:
    value = _required(row, key)
    if not re.fullmatch(prefix + r"\d+", value):
        raise RowError(f"bad {key} {value!r}")
    return value


def _int(row: dict, key: str) -> int | None:
    value = _text(row, key)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        raise RowError(f"bad integer {key}={value!r}") from None


def _decimal(row: dict, key: str) -> Decimal | None:
    value = _text(row, key)
    if value is None:
        return None
    try:
        return Decimal(value)
    except InvalidOperation:
        raise RowError(f"bad decimal {key}={value!r}") from None


def _json_list(row: dict, key: str) -> tuple[str, ...]:
    value = _text(row, key)
    if value is None:
        return ()
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        raise RowError(f"bad JSON list {key}={value!r}") from None
    if not isinstance(data, list):
        raise RowError(f"{key} is not a JSON list")
    return tuple(str(item) for item in data)


def _bool(row: dict, key: str) -> bool:
    value = (_text(row, key) or "false").lower()
    if value in ("true", "1"):
        return True
    if value in ("false", "0"):
        return False
    raise RowError(f"bad boolean {key}={value!r}")
