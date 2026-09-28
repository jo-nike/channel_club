"""Immediate, process-local admission: no unbounded executor or semaphore queues."""

from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException

from app.config import settings


class MediaCapacityError(HTTPException):
    """No process/export slot is currently available."""

    def __init__(self):
        super().__init__(429, "Media capacity exhausted; retry after active work finishes")


class MediaBudget:
    def __init__(self, kind: str):
        self.kind = kind
        self.owners: Counter[str] = Counter()

    def acquire(self, owner: str) -> None:
        global_limit = getattr(settings, f"media_{self.kind}_limit")
        user_limit = getattr(settings, f"media_{self.kind}_per_user")
        if sum(self.owners.values()) >= global_limit or self.owners[owner] >= user_limit:
            raise MediaCapacityError()
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

    def reset(self) -> None:
        self.owners.clear()


# Cast sessions; per user, so one viewer cannot take every FFmpeg slot.
process_budget = MediaBudget("process")
# Shared highlight recorders, charged to no viewer: optional recording never blocks a cast.
recorder_budget = MediaBudget("recorder")
export_budget = MediaBudget("export")


def reset_media_budgets() -> None:
    """Forget every held slot (tests start from empty budgets)."""
    for budget in (process_budget, recorder_budget, export_budget):
        budget.reset()
