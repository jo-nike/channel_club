"""Share synchronous feed refresh work and failures across bounded executor workers."""

from functools import wraps
from threading import RLock
from time import monotonic


def serialized_refresh(function):
    lock = RLock()
    retry_at = 0.0
    failure = None

    @wraps(function)
    def wrapped(*args, **kwargs):
        nonlocal retry_at, failure
        with lock:
            if failure is not None and monotonic() < retry_at:
                raise RuntimeError("Feed temporarily unavailable; retry later") from failure
            try:
                result = function(*args, **kwargs)
                failure = None
                return result
            except Exception as exc:
                failure = exc
                retry_at = monotonic() + 5
                raise

    def reset_failure():
        nonlocal retry_at, failure
        with lock:
            retry_at, failure = 0.0, None

    wrapped.__dict__["reset_failure"] = reset_failure
    return wrapped
