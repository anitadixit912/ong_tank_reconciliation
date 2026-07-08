"""Root conftest.py — sets IBD_TESTING=1 and provides shared fixtures."""
from __future__ import annotations
import os
os.environ["IBD_TESTING"] = "1"

import json
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import pytest

AGENT_ROOT = Path(__file__).parent


@pytest.fixture(scope="session")
def agent_path() -> Path:
    return AGENT_ROOT


@pytest.fixture(scope="session")
def agent_app_path(agent_path: Path) -> Path:
    return agent_path / "app"


@pytest.fixture(scope="session")
def add_agent_to_path(agent_app_path: Path):
    p = str(agent_app_path)
    added = False
    if p not in sys.path:
        sys.path.insert(0, p)
        added = True
    yield
    if added and p in sys.path:
        sys.path.remove(p)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "structure: Tests for file and module structure")
    config.addinivalue_line("markers", "server: Tests for server startup and A2A endpoints")
