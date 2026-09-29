"""Centralized logging configuration using loguru."""

import inspect
import logging
import re
import sys
from urllib.parse import unquote

from loguru import logger

from app.config import settings

_CREDENTIAL_KEY = re.compile(
    r"^(?:token|access_token|authToken|authorization|password|api[_-]?key|x-plex-token)$",
    re.IGNORECASE,
)
_QUERY_VALUE = re.compile(r"([?&])([^=&\s]+)=([^&\s\\\"'<>]*)")
_CREDENTIAL_TEXT = re.compile(
    r"([?&](?:token|access_token|authToken|api[_-]?key|x-plex-token)=)[^&\s\\\"'<>]*"
    r"|(Bearer\s+)[^\s\"'<>]+",
    re.IGNORECASE,
)


def redact_credentials(value):
    """Copy diagnostic data with reusable credentials removed before any sink."""
    if isinstance(value, str):
        value = _QUERY_VALUE.sub(
            lambda match: (
                match[1] + match[2] + "=[REDACTED]"
                if _CREDENTIAL_KEY.fullmatch(unquote(match[2]))
                else match[0]
            ),
            value,
        )
        return _CREDENTIAL_TEXT.sub(lambda match: (match[1] or match[2]) + "[REDACTED]", value)
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if _CREDENTIAL_KEY.match(str(key)) else redact_credentials(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return type(value)(redact_credentials(item) for item in value)
    return value


def _redact_record(record):
    record["message"] = redact_credentials(record["message"])
    record["extra"] = redact_credentials(record["extra"])
    exception = record["exception"]
    if exception is not None and exception.value is not None:
        record["exception"] = exception._replace(
            value=Exception(redact_credentials(str(exception.value)))
        )


class InterceptHandler(logging.Handler):
    """Handler to intercept standard library logging and route to loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        """Route standard library log records to loguru."""
        # Get corresponding loguru level if it exists
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Find caller from where originated the logged message
        frame, depth = inspect.currentframe(), 0
        while frame and (depth == 0 or frame.f_code.co_filename == logging.__file__):
            frame = frame.f_back
            depth += 1

        record.msg = redact_credentials(record.getMessage())
        record.args = ()
        if record.exc_info and record.exc_info[1] is not None:
            kind, value, traceback = record.exc_info
            record.exc_info = (kind, Exception(redact_credentials(str(value))), traceback)
        logger.bind(logger_name=record.name).opt(depth=depth, exception=record.exc_info).log(
            level, record.msg
        )


# Polled and streamed paths whose access lines are pure volume. NPM keeps the
# full access log, so uvicorn only logs the rest.
_QUIET_ACCESS_PATHS = ("/api/health", "/api/health/deps", "/api/admin/status")
_QUIET_ACCESS_PREFIXES = (
    "/api/ersatztv/segments/",
    "/api/ersatztv/stream/",
    "/api/ersatztv/s/",
    "/api/highlight/status/",
)


class QuietAccessFilter(logging.Filter):
    """Drop uvicorn.access lines for health checks, status polls and media."""

    def filter(self, record: logging.LogRecord) -> bool:
        # uvicorn.access args: (client_addr, method, full_path, http_version, status_code)
        if not isinstance(record.args, tuple) or len(record.args) < 3:
            return True
        path = str(record.args[2]).split("?", 1)[0]
        return path not in _QUIET_ACCESS_PATHS and not path.startswith(_QUIET_ACCESS_PREFIXES)


_quiet_access_filter = QuietAccessFilter()


def _is_event(record) -> bool:
    return "event" in record["extra"]


def _is_not_event(record) -> bool:
    return "event" not in record["extra"]


def configure_logging() -> None:
    """Configure loguru with format based on LOG_FORMAT setting.

    Removes default handler and adds new handler with appropriate format.
    Also intercepts standard library logging for consistent formatting.
    Safe to call more than once.
    """
    # Remove default loguru handler
    logger.remove()
    logger.configure(patcher=_redact_record)

    log_level = settings.log_level

    # Analytics events (records with an "event" extra) get their own sink at
    # INFO, so raising LOG_LEVEL to cut noise never drops them. The main sink
    # skips them, so each event line is written once.
    if settings.log_format == "json":
        # JSON format for structured logging
        for level, sink_filter in ((log_level, _is_not_event), ("INFO", _is_event)):
            logger.add(
                sys.stderr,
                format="{message}",
                level=level,
                filter=sink_filter,
                serialize=True,
                diagnose=False,
            )
    else:
        # Pretty format with colors for development
        for level, sink_filter in ((log_level, _is_not_event), ("INFO", _is_event)):
            logger.add(
                sys.stderr,
                format=(
                    "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
                    "<level>{level: <8}</level> | "
                    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
                    "<level>{message}</level>"
                ),
                filter=sink_filter,
                colorize=True,
                diagnose=False,
                level=level,
            )

    # Intercept standard library logging (uvicorn, FastAPI, etc.). The root
    # level matches the sink, so records loguru would drop are never built.
    logging.basicConfig(handlers=[InterceptHandler()], level=logger.level(log_level).no, force=True)

    # Only the root logger intercepts: these loggers hand their records up to it,
    # so each line is written once (uvicorn.error used to reach two handlers)
    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"]:
        logging.getLogger(logger_name).handlers = []
        logging.getLogger(logger_name).propagate = True

    # One INFO line per upstream request (and ~13 httpcore DEBUG records) is noise;
    # services log upstream failures themselves
    for logger_name in ["httpx", "httpcore"]:
        logging.getLogger(logger_name).setLevel(logging.WARNING)

    logging.getLogger("uvicorn.access").addFilter(_quiet_access_filter)
