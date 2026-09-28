import pytest
from rdflib import Graph, URIRef
from rdflib.namespace import OWL, RDF, RDFS

from pipeline.config import DBO, MO, ONTOLOGY_PATH, SCHEMA

ONTOLOGY_URI = URIRef("https://lod-movie.felix-nguyen.io.vn/ontology")
KINDS = (OWL.Class, OWL.ObjectProperty, OWL.DatatypeProperty)


@pytest.fixture(scope="module")
def onto():
    return Graph().parse(ONTOLOGY_PATH)


def terms(onto, kinds=KINDS):
    return sorted({s for kind in kinds for s in onto.subjects(RDF.type, kind) if str(s).startswith(str(MO))})


def test_ontology_header(onto):
    assert (ONTOLOGY_URI, RDF.type, OWL.Ontology) in onto
    assert onto.value(ONTOLOGY_URI, OWL.versionInfo) is not None


def test_expected_classes(onto):
    names = {str(t).split("#")[1] for t in terms(onto, (OWL.Class,))}
    assert names == {"Movie", "Person", "Genre", "Profession", "Credit"}


def test_every_term_has_label_and_comment(onto):
    for term in terms(onto):
        assert onto.value(term, RDFS.label) is not None, term
        assert onto.value(term, RDFS.comment) is not None, term


def test_every_property_has_domain_and_range(onto):
    for prop in terms(onto, (OWL.ObjectProperty, OWL.DatatypeProperty)):
        assert onto.value(prop, RDFS.domain) is not None, prop
        assert onto.value(prop, RDFS.range) is not None, prop


def test_alignment_to_standard_vocabularies(onto):
    assert (MO.Movie, RDFS.subClassOf, SCHEMA.Movie) in onto
    assert (MO.Movie, OWL.equivalentClass, DBO.Film) in onto
    assert (MO.directedBy, RDFS.subPropertyOf, SCHEMA.director) in onto
    assert (MO.hasActor, OWL.inverseOf, MO.actedIn) in onto
    assert (MO.creditedPerson, RDF.type, OWL.FunctionalProperty) in onto
