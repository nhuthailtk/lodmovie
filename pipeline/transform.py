"""4-star layer: turn the crawl into RDF that follows the ontology, with a URI for every thing."""

from __future__ import annotations

from rdflib import Graph, Literal, URIRef
from rdflib.namespace import FOAF, RDF, RDFS, SKOS

from .config import MO, SCHEMA, bind_namespaces
from .load import Crawl, Credit, Movie, Person
from .translate import TitleRow
from .uris import (
    credit_uri,
    genre_uri,
    imdb_name_page,
    imdb_title_page,
    movie_uri,
    person_uri,
    profession_uri,
)

# IMDb has no gender field; it is derived from the actor / actress profession or credit role.
GENDER_CLASS = {"actor": MO.Man, "actress": MO.Woman}

ROLE_PROPERTY = {"actor": MO.hasActor, "director": MO.directedBy, "writer": MO.writtenBy}


def build_data_graph(crawl: Crawl, titles: dict[str, TitleRow]) -> tuple[Graph, list[str]]:
    graph = bind_namespaces(Graph())
    warnings: list[str] = []

    _add_scheme(graph, MO.GenreScheme, "LOD Movie genres")
    _add_scheme(graph, MO.ProfessionScheme, "LOD Movie professions")
    for name, is_target in sorted(crawl.genres.items()):
        _add_genre(graph, name, is_target)
    for name in sorted(crawl.professions):
        _add_profession(graph, name)

    for movie in crawl.movies.values():
        _add_movie(graph, movie, titles.get(movie.imdb_id), warnings)
    roles: dict[str, set[str]] = {}
    for credit in crawl.credits.values():
        roles.setdefault(credit.person_id, set()).add(credit.category)
    for person in crawl.people.values():
        _add_person(graph, person, crawl.movies.keys(), roles.get(person.person_id, set()), warnings)
    for credit in crawl.credits.values():
        _add_credit(graph, credit)

    for imdb_id, genre in crawl.movie_genres:
        graph.add((movie_uri(imdb_id), MO.hasGenre, genre_uri(genre)))
    for imdb_id, genre in crawl.sampling:
        graph.add((movie_uri(imdb_id), MO.sampledForGenre, genre_uri(genre)))
    for imdb_id, person_id, role in crawl.movie_people:
        graph.add((movie_uri(imdb_id), ROLE_PROPERTY[role], person_uri(person_id)))
    return graph, warnings


def _add_scheme(graph: Graph, scheme: URIRef, label: str) -> None:
    graph.add((scheme, RDF.type, SKOS.ConceptScheme))
    graph.add((scheme, SKOS.prefLabel, Literal(label, lang="en")))


def _add_genre(graph: Graph, name: str, is_target: bool) -> None:
    uri = genre_uri(name)
    graph.add((uri, RDF.type, MO.Genre))
    graph.add((uri, RDF.type, SKOS.Concept))
    graph.add((uri, SKOS.prefLabel, Literal(name, lang="en")))
    graph.add((uri, SKOS.inScheme, MO.GenreScheme))
    graph.add((uri, MO.isTargetGenre, Literal(is_target)))


def _add_profession(graph: Graph, name: str) -> None:
    uri = profession_uri(name)
    graph.add((uri, RDF.type, MO.Profession))
    graph.add((uri, RDF.type, SKOS.Concept))
    graph.add((uri, SKOS.prefLabel, Literal(name.replace("_", " "), lang="en")))
    graph.add((uri, SKOS.inScheme, MO.ProfessionScheme))


def _add_movie(graph: Graph, movie: Movie, title: TitleRow | None, warnings: list[str]) -> None:
    uri = movie_uri(movie.imdb_id)
    graph.add((uri, RDF.type, MO.Movie))
    graph.add((uri, MO.imdbId, Literal(movie.imdb_id)))
    graph.add((uri, MO.tconst, Literal(movie.imdb_id)))
    graph.add((uri, MO.primaryTitle, Literal(movie.primary_title)))
    if movie.original_title:
        graph.add((uri, MO.originalTitle, Literal(movie.original_title)))

    if title is None:
        warnings.append(f"{movie.imdb_id}: no translation, using the untagged primary title as label")
        labels = [Literal(movie.primary_title)]
    else:
        if title.primary_title != movie.primary_title:
            warnings.append(f"{movie.imdb_id}: title was translated from an older IMDb title {title.primary_title!r}")
        labels = [Literal(title.title_en, lang="en"), Literal(title.title_vi, lang="vi")]
    for label in labels:
        graph.add((uri, RDFS.label, label))
        graph.add((uri, SCHEMA.name, label))

    for prop, value in (
        (MO.releaseYear, movie.release_year),
        (MO.runtimeMinutes, movie.runtime_minutes),
        (MO.averageRating, movie.average_rating),
        (MO.numVotes, movie.num_votes),
    ):
        if value is not None:
            graph.add((uri, prop, Literal(value)))

    page = imdb_title_page(movie.imdb_id)
    graph.add((uri, RDFS.seeAlso, page))
    graph.add((uri, FOAF.isPrimaryTopicOf, page))


def _add_person(graph: Graph, person: Person, movie_ids, credit_roles: set[str], warnings: list[str]) -> None:
    uri = person_uri(person.person_id)
    graph.add((uri, RDF.type, MO.Person))
    genders = {GENDER_CLASS[r] for r in set(person.professions) | credit_roles if r in GENDER_CLASS}
    if len(genders) == 1:
        graph.add((uri, RDF.type, genders.pop()))
    elif genders:
        warnings.append(f"{person.person_id}: both actor and actress, no gender asserted (Man and Woman are disjoint)")
    graph.add((uri, RDFS.label, Literal(person.name)))
    graph.add((uri, SCHEMA.name, Literal(person.name)))
    graph.add((uri, MO.imdbId, Literal(person.person_id)))
    graph.add((uri, MO.nconst, Literal(person.person_id)))
    if person.birth_year is not None:
        graph.add((uri, MO.birthYear, Literal(person.birth_year)))
    if person.death_year is not None:
        graph.add((uri, MO.deathYear, Literal(person.death_year)))
    for profession in person.professions:
        graph.add((uri, MO.primaryProfession, profession_uri(profession)))
    for imdb_id in person.known_for:
        if imdb_id in movie_ids:
            graph.add((uri, MO.knownFor, movie_uri(imdb_id)))
    page = imdb_name_page(person.person_id)
    graph.add((uri, RDFS.seeAlso, page))
    graph.add((uri, FOAF.isPrimaryTopicOf, page))


def _add_credit(graph: Graph, credit: Credit) -> None:
    uri = credit_uri(credit.imdb_id, credit.ordering)
    graph.add((movie_uri(credit.imdb_id), MO.hasCredit, uri))
    graph.add((uri, RDF.type, MO.Credit))
    graph.add((uri, MO.creditedPerson, person_uri(credit.person_id)))
    graph.add((uri, MO.creditRole, profession_uri(credit.category)))
    graph.add((uri, MO.billingOrder, Literal(credit.ordering)))
    if credit.job:
        graph.add((uri, MO.job, Literal(credit.job)))
    for character in credit.characters:
        graph.add((uri, MO.characterName, Literal(character)))
