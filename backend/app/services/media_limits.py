"""Immediate, process-local admission: no unbounded executor or semaphore queues."""

from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException

from app.config import settings


class MediaBudget:
    def __init__(self, kind: str):
        self.kind = kind
        self.owners: Counter[str] = Counter()

    def acquire(self, owner: str) -> None:
        global_limit = getattr(settings, f"media_{self.kind}_limit")
        user_limit = getattr(settings, f"media_{self.kind}_per_user")
        if sum(self.owners.values()) >= global_limit or self.owners[owner] >= user_limit:
            raise HTTPException(429, "Media capacity exhausted; retry after active work finishes")
        self.owners[owner] += 1

    def release(self, owner: str) -> None:
        if self.owners[owner] > 1:
            self.owners[owner] -= 1
        else:
            self.owners.pop(owner, None)

    @contextmanager
    def slot(self, owner: str) -> Iterator[None]:
        self.acquire(owner)
        try:
            yield
        finally:
            self.release(owner)


process_budget = MediaBudget("process")
export_budget = MediaBudget("export")
