"""The autouse reset_module_state fixture clears module state between tests (G-14).

The first test leaves state behind on purpose; the second, which runs after it
in file order, must start clean.
"""

import time

from app.services import plex
from app.services.highlight import highlight_service


def test_leaves_state_behind() -> None:
    plex._server_owner_id_cache["owner_id"] = "42"
    highlight_service._start_failures["ch1"] = (1, time.monotonic() + 300)


def test_next_test_starts_clean() -> None:
    assert plex._server_owner_id_cache == {}
    assert plex._owner_id_lookup is None
    assert highlight_service._start_failures == {}
