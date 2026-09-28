"""Quality gate: SHACL shapes plus referential and blank-node checks. Violations stop the build."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pyshacl
from rdflib import BNode, Graph, URIRef
from rdflib.namespace import RDF, SH

from .config import RESOURCE, SHAPES_PATH


@dataclass
class ValidationResult:
    violations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def conforms(self) -> bool:
        return not self.violations


def validate(ontology: Graph, data: Graph, links: Graph, shapes_path: Path = SHAPES_PATH) -> ValidationResult:
    combined = Graph()
    combined += data
    combined += links
    shapes = Graph().parse(shapes_path)
    _, report, _ = pyshacl.validate(combined, shacl_graph=shapes, ont_graph=ontology, inference="none")

    result = ValidationResult()
    for node in report.subjects(RDF.type, SH.ValidationResult):
        message = (
            f"{report.value(node, SH.focusNode)} {report.value(node, SH.resultPath)}: "
            f"{report.value(node, SH.resultMessage)} (value: {report.value(node, SH.value)})"
        )
        if report.value(node, SH.resultSeverity) == SH.Violation:
            result.violations.append(message)
        else:
            result.warnings.append(message)
    result.violations.extend(_reference_errors(data, links))
    result.violations.sort()
    result.warnings.sort()
    return result


def _reference_errors(data: Graph, links: Graph) -> list[str]:
    typed = set(data.subjects(RDF.type, None))
    errors = set()
    for graph in (data, links):
        for s, p, o in graph:
            for term in (s, o):
                if isinstance(term, BNode):
                    errors.add(f"blank node in ({s} {p} {o})")
                elif isinstance(term, URIRef) and str(term).startswith(RESOURCE) and term not in typed:
                    errors.add(f"{term}: referenced but has no rdf:type")
    return sorted(errors)
