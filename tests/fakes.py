"""Test doubles for the Wikidata SPARQL endpoint."""

import json

from pipeline.link import WikidataError


class FakeResponse:
    def __init__(self, status, payload=None, headers=None):
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}
        self.text = json.dumps(payload) if payload is not None else ""

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.headers = {}
        self.queries = []

    def post(self, url, data=None, timeout=None):
        self.queries.append(data["query"])
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class FakeClient:
    """Answers lookups from a dict; optionally fails on the N-th call (1-based)."""

    def __init__(self, answers, fail_on_call=None):
        self.answers = answers
        self.fail_on_call = fail_on_call
        self.batches = []

    def lookup(self, imdb_ids):
        self.batches.append(list(imdb_ids))
        if self.fail_on_call == len(self.batches):
            raise WikidataError("simulated outage")
        return {i: self.answers[i] for i in imdb_ids if i in self.answers}
