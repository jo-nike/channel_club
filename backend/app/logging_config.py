"""Centralized logging configuration using loguru."""

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
        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        record.msg = redact_credentials(record.getMessage())
        record.args = ()
        if record.exc_info and record.exc_info[1] is not None:
            kind, value, traceback = record.exc_info
            record.exc_info = (kind, Exception(redact_credentials(str(value))), traceback)
        logger.opt(depth=depth, exception=record.exc_info).log(level, record.msg)


def configure_logging() -> None:
    """Configure loguru with format based on LOG_FORMAT setting.

    Removes default handler and adds new handler with appropriate format.
    Also intercepts standard library logging for consistent formatting.
    """
    # Remove default loguru handler
    logger.remove()
    logger.configure(patcher=_redact_record)

    log_level = settings.log_level.upper()

    if settings.log_format.lower() == "json":
        # JSON format for structured logging
        logger.add(
            sys.stderr,
            format="{message}",
            level=log_level,
            serialize=True,
            diagnose=False,
        )
    else:
        # Pretty format with colors for development
        logger.add(
            sys.stderr,
            format=(
                "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
                "<level>{level: <8}</level> | "
                "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
                "<level>{message}</level>"
            ),
            colorize=True,
            diagnose=False,
            level=log_level,
        )

    # Intercept standard library logging (uvicorn, FastAPI, etc.)
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)

    # Set specific loggers to appropriate levels to reduce noise
    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"]:
        logging.getLogger(logger_name).handlers = [InterceptHandler()]
