"""Process-local admission: immediate, or a short bounded wait; never an unbounded queue."""

import asyncio
from collections import Counter
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager

from fastapi import HTTPException

from app.config import settings

# How long a capture or export waits for a slot before 429: under the browser's patience and
# NPM's proxy_read_timeout, so everyone who clips the same moment gets a turn.
SLOT_WAIT_SECONDS = 15


class MediaCapacityError(HTTPException):
    """No process/export slot is currently available."""

    def __init__(self):
        super().__init__(429, "Media capacity exhausted; retry after active work finishes")


class MediaBudget:
    def __init__(self, kind: str):
        self.kind = kind
        self.owners: Counter[str] = Counter()
        # Woken on every release; each waiter then retries acquire() itself.
        self._waiters: list[asyncio.Future[None]] = []

    def acquire(self, owner: str) -> None:
        global_limit = getattr(settings, f"media_{self.kind}_limit")
        # Recorders have one shared owner, so only the global limit applies to them.
        user_limit = getattr(settings, f"media_{self.kind}_per_user", global_limit)
        if sum(self.owners.values()) >= global_limit or self.owners[owner] >= user_limit:
            raise MediaCapacityError()
        self.owners[owner] += 1

    def release(self, owner: str) -> None:
        if self.owners[owner] > 1:
            self.owners[owner] -= 1
        else:
            self.owners.pop(owner, None)
        for waiter in self._waiters:
            if not waiter.done():
                waiter.set_result(None)

    async def wait_acquire(self, owner: str, timeout: float = SLOT_WAIT_SECONDS) -> None:
        """Acquire, waiting up to `timeout` for a release; 429 when the wait runs out.

        Only a waiter that is still running takes the slot, so a cancelled request
        (the client left) never holds one.
        """
        try:
            async with asyncio.timeout(timeout):
                while True:
                    try:
                        self.acquire(owner)
                        return
                    except MediaCapacityError:
                        pass
                    waiter = asyncio.get_running_loop().create_future()
                    self._waiters.append(waiter)
                    try:
                        await waiter
                    finally:
                        if waiter in self._waiters:
                            self._waiters.remove(waiter)
        except TimeoutError:
            raise MediaCapacityError() from None

    @contextmanager
    def slot(self, owner: str) -> Iterator[None]:
        self.acquire(owner)
        try:
            yield
        finally:
            self.release(owner)

    @asynccontextmanager
    async def waiting_slot(self, owner: str) -> AsyncIterator[None]:
        await self.wait_acquire(owner)
        try:
            yield
        finally:
            self.release(owner)

    def reset(self) -> None:
        self.owners.clear()
        self._waiters.clear()


# Cast sessions; per user, so one viewer cannot take every FFmpeg slot.
process_budget = MediaBudget("process")
# Shared highlight recorders, charged to no viewer: optional recording never blocks a cast.
recorder_budget = MediaBudget("recorder")
# CPU-bound capture remuxes and export encodes.
export_budget = MediaBudget("export")
# Network-bound Zipline uploads, kept off the export slots.
upload_budget = MediaBudget("upload")


def reset_media_budgets() -> None:
    """Forget every held slot and waiter (tests start from empty budgets)."""
    for budget in (process_budget, recorder_budget, export_budget, upload_budget):
        budget.reset()
