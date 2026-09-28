import pytest
from rdflib import URIRef

from pipeline.uris import (
    GENRE_SCHEME,
    credit_uri,
    genre_uri,
    imdb_name_page,
    imdb_title_page,
    movie_uri,
    person_uri,
    profession_uri,
    slug,
)

BASE = "https://lod-movie.felix-nguyen.io.vn/resource/"


@pytest.mark.parametrize(
    "value, expected",
    [
        ("Sci-Fi", "sci-fi"),
        ("casting_director", "casting-director"),
        ("Action", "action"),
        ("  Film--Noir  ", "film-noir"),
        ("music_department", "music-department"),
    ],
)
def test_slug(value, expected):
    assert slug(value) == expected


def test_slug_rejects_values_without_letters_or_digits():
    with pytest.raises(ValueError):
        slug("--")


def test_resource_uris():
    assert movie_uri("tt0081633") == URIRef(BASE + "movie/tt0081633")
    assert person_uri("nm0000025") == URIRef(BASE + "person/nm0000025")
    assert genre_uri("Sci-Fi") == URIRef(BASE + "genre/sci-fi")
    assert profession_uri("casting_director") == URIRef(BASE + "profession/casting-director")
    assert credit_uri("tt0081633", 3) == URIRef(BASE + "credit/tt0081633-3")
    assert GENRE_SCHEME == URIRef(BASE + "scheme/genres")


def test_imdb_pages():
    assert imdb_title_page("tt1") == URIRef("https://www.imdb.com/title/tt1/")
    assert imdb_name_page("nm1") == URIRef("https://www.imdb.com/name/nm1/")
