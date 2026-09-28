from pathlib import Path

import pytest

from pipeline.load import load_crawl

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def crawl_a():
    return load_crawl([FIXTURES / "crawl_a"])


@pytest.fixture
def crawl_ab():
    return load_crawl([FIXTURES / "crawl_a", FIXTURES / "crawl_b"])
