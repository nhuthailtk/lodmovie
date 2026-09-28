"""Stable URIs for every resource, derived only from IMDb IDs and slugs."""

from __future__ import annotations

import re

from rdflib import URIRef

from .config import RESOURCE

GENRE_SCHEME = URIRef(RESOURCE + "scheme/genres")
PROFESSION_SCHEME = URIRef(RESOURCE + "scheme/professions")


def slug(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not result:
        raise ValueError(f"cannot make a slug from {value!r}")
    return result


def movie_uri(imdb_id: str) -> URIRef:
    return URIRef(f"{RESOURCE}movie/{imdb_id}")


def person_uri(person_id: str) -> URIRef:
    return URIRef(f"{RESOURCE}person/{person_id}")


def genre_uri(name: str) -> URIRef:
    return URIRef(f"{RESOURCE}genre/{slug(name)}")


def profession_uri(name: str) -> URIRef:
    return URIRef(f"{RESOURCE}profession/{slug(name)}")


def credit_uri(imdb_id: str, ordering: int) -> URIRef:
    return URIRef(f"{RESOURCE}credit/{imdb_id}-{ordering}")


def imdb_title_page(imdb_id: str) -> URIRef:
    return URIRef(f"https://www.imdb.com/title/{imdb_id}/")


def imdb_name_page(person_id: str) -> URIRef:
    return URIRef(f"https://www.imdb.com/name/{person_id}/")
