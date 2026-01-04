"""Centralized logging configuration using loguru."""

import logging
import sys

from loguru import logger

from app.config import settings


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

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def configure_logging() -> None:
    """Configure loguru with format based on LOG_FORMAT setting.

    Removes default handler and adds new handler with appropriate format.
    Also intercepts standard library logging for consistent formatting.
    """
    # Remove default loguru handler
    logger.remove()

    log_level = settings.log_level.upper()

    if settings.log_format.lower() == "json":
        # JSON format for structured logging
        logger.add(
            sys.stderr,
            format="{message}",
            level=log_level,
            serialize=True,
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
            level=log_level,
        )

    # Intercept standard library logging (uvicorn, FastAPI, etc.)
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)

    # Set specific loggers to appropriate levels to reduce noise
    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"]:
        logging.getLogger(logger_name).handlers = [InterceptHandler()]
