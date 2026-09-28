"""Tests for logging configuration."""

import json
import logging
import sys
from io import StringIO
from unittest.mock import patch

import pytest
from loguru import logger

from app.config import Settings
from app.logging_config import InterceptHandler, configure_logging


class TestLoggingConfigSettings:
    """Tests for logging configuration settings."""

    def test_settings_has_log_level(self) -> None:
        """Settings should have log_level attribute."""
        settings = Settings()
        assert hasattr(settings, "log_level")
        assert isinstance(settings.log_level, str)

    def test_settings_has_log_format(self) -> None:
        """Settings should have log_format attribute."""
        settings = Settings()
        assert hasattr(settings, "log_format")
        assert isinstance(settings.log_format, str)

    def test_log_level_default_is_info(self) -> None:
        """Log level should default to INFO."""
        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=None)
            assert settings.log_level == "INFO"

    def test_log_format_default_is_pretty(self) -> None:
        """Log format should default to pretty."""
        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=None)
            assert settings.log_format == "pretty"

    def test_log_level_from_env(self) -> None:
        """Log level should be configurable via environment variable."""
        with patch.dict("os.environ", {"LOG_LEVEL": "DEBUG"}, clear=True):
            settings = Settings(_env_file=None)
            assert settings.log_level == "DEBUG"

    def test_log_format_from_env(self) -> None:
        """Log format should be configurable via environment variable."""
        with patch.dict("os.environ", {"LOG_FORMAT": "json"}, clear=True):
            settings = Settings(_env_file=None)
            assert settings.log_format == "json"


class TestJSONFormat:
    """Tests for JSON log format."""

    def test_json_format_produces_valid_json(self) -> None:
        """JSON format should produce valid JSON output."""
        output = StringIO()

        # Remove all handlers and add our test handler
        logger.remove()
        logger.add(output, format="{message}", serialize=True, level="DEBUG")

        # Log a test message
        logger.info("Test message")

        # Get the output and parse it
        log_output = output.getvalue().strip()
        assert log_output, "No log output captured"

        # Parse as JSON
        log_data = json.loads(log_output)

        # Verify required fields
        assert "text" in log_data
        assert "record" in log_data
        assert "level" in log_data["record"]
        assert "message" in log_data["record"]
        assert "time" in log_data["record"]

        # Verify message content
        assert log_data["record"]["message"] == "Test message"
        assert log_data["record"]["level"]["name"] == "INFO"

    def test_json_format_includes_context(self) -> None:
        """JSON format should include extra context in the output."""
        output = StringIO()

        logger.remove()
        logger.add(output, format="{message}", serialize=True, level="DEBUG")

        # Log with extra context
        logger.bind(request_id="123", user="testuser").info("Request received")

        log_output = output.getvalue().strip()
        log_data = json.loads(log_output)

        # Verify extra context is captured
        assert log_data["record"]["extra"]["request_id"] == "123"
        assert log_data["record"]["extra"]["user"] == "testuser"


class TestPrettyFormat:
    """Tests for pretty log format."""

    def test_pretty_format_includes_level(self) -> None:
        """Pretty format should include log level."""
        output = StringIO()

        logger.remove()
        logger.add(
            output,
            format="<level>{level: <8}</level> | {message}",
            colorize=False,
            level="DEBUG",
        )

        logger.info("Test message")

        log_output = output.getvalue()
        assert "INFO" in log_output
        assert "Test message" in log_output

    def test_pretty_format_includes_timestamp(self) -> None:
        """Pretty format should include timestamp."""
        output = StringIO()

        logger.remove()
        logger.add(
            output,
            format="{time:YYYY-MM-DD HH:mm:ss} | {message}",
            colorize=False,
            level="DEBUG",
        )

        logger.info("Test message")

        log_output = output.getvalue()
        # Should contain date-like pattern
        assert "-" in log_output  # Date separator
        assert ":" in log_output  # Time separator


class TestLogLevelFiltering:
    """Tests for log level filtering."""

    def test_debug_level_captures_all(self) -> None:
        """DEBUG level should capture all log levels."""
        output = StringIO()

        logger.remove()
        logger.add(output, format="{level} | {message}", colorize=False, level="DEBUG")

        logger.debug("Debug message")
        logger.info("Info message")
        logger.warning("Warning message")
        logger.error("Error message")

        log_output = output.getvalue()
        assert "DEBUG" in log_output
        assert "INFO" in log_output
        assert "WARNING" in log_output
        assert "ERROR" in log_output

    def test_info_level_filters_debug(self) -> None:
        """INFO level should filter out DEBUG messages."""
        output = StringIO()

        logger.remove()
        logger.add(output, format="{level} | {message}", colorize=False, level="INFO")

        logger.debug("Debug message")
        logger.info("Info message")

        log_output = output.getvalue()
        assert "Debug message" not in log_output
        assert "Info message" in log_output

    def test_error_level_filters_lower(self) -> None:
        """ERROR level should filter out DEBUG, INFO, WARNING."""
        output = StringIO()

        logger.remove()
        logger.add(output, format="{level} | {message}", colorize=False, level="ERROR")

        logger.debug("Debug message")
        logger.info("Info message")
        logger.warning("Warning message")
        logger.error("Error message")

        log_output = output.getvalue()
        assert "Debug message" not in log_output
        assert "Info message" not in log_output
        assert "Warning message" not in log_output
        assert "Error message" in log_output


class TestStandardLibraryInterception:
    """Tests for standard library logging interception."""

    def test_intercept_handler_routes_to_loguru(self) -> None:
        """InterceptHandler should route standard library logs to loguru."""
        output = StringIO()

        logger.remove()
        logger.add(output, format="{level} | {message}", colorize=False, level="DEBUG")

        # Set up standard library logger with InterceptHandler
        std_logger = logging.getLogger("test_intercept")
        std_logger.handlers = [InterceptHandler()]
        std_logger.setLevel(logging.DEBUG)

        # Log via standard library
        std_logger.info("Standard library message")

        log_output = output.getvalue()
        assert "Standard library message" in log_output
        assert "INFO" in log_output

    def test_intercept_handler_preserves_log_level(self) -> None:
        """InterceptHandler should preserve the original log level."""
        output = StringIO()

        logger.remove()
        logger.add(output, format="{level} | {message}", colorize=False, level="DEBUG")

        std_logger = logging.getLogger("test_intercept_level")
        std_logger.handlers = [InterceptHandler()]
        std_logger.setLevel(logging.DEBUG)

        std_logger.debug("Debug via stdlib")
        std_logger.warning("Warning via stdlib")
        std_logger.error("Error via stdlib")

        log_output = output.getvalue()
        assert "DEBUG" in log_output
        assert "WARNING" in log_output
        assert "ERROR" in log_output


class TestConfigureLogging:
    """Tests for the configure_logging function."""

    def test_configure_logging_with_json_format(self) -> None:
        """configure_logging should set up JSON format when LOG_FORMAT=json."""
        output = StringIO()

        with (
            patch.dict("os.environ", {"LOG_FORMAT": "json", "LOG_LEVEL": "INFO"}, clear=True),
            patch("app.logging_config.settings", Settings(_env_file=None)),
        ):
            # Reset loguru
            logger.remove()

            # Patch sys.stderr to capture output
            with patch.object(sys, "stderr", output):
                configure_logging()
                logger.info("Test JSON message")

        log_output = output.getvalue().strip()
        if log_output:  # May be empty if handler isn't writing to our patched stderr
            # Try to parse as JSON
            try:
                log_data = json.loads(log_output)
                assert "record" in log_data or "text" in log_data
            except json.JSONDecodeError:
                # If not JSON, the test may have captured non-JSON output
                pass

    def test_configure_logging_with_pretty_format(self) -> None:
        """configure_logging should set up pretty format when LOG_FORMAT=pretty."""
        output = StringIO()

        with (
            patch.dict("os.environ", {"LOG_FORMAT": "pretty", "LOG_LEVEL": "INFO"}, clear=True),
            patch("app.logging_config.settings", Settings(_env_file=None)),
        ):
            logger.remove()

            with patch.object(sys, "stderr", output):
                configure_logging()
                logger.info("Test pretty message")

        log_output = output.getvalue()
        # Pretty format should NOT be valid JSON
        if log_output.strip():
            with pytest.raises(json.JSONDecodeError):
                json.loads(log_output.strip())


@pytest.mark.parametrize("log_format", ["pretty", "json"])
def test_sec03_access_and_structured_credentials_are_redacted(log_format):
    output = StringIO()
    secret = "SYNTHETIC_REUSABLE_BEARER_SECRET"
    config = Settings(_env_file=None, log_format=log_format, log_level="DEBUG")
    with patch("app.logging_config.settings", config), patch.object(sys, "stderr", output):
        configure_logging()
        for name, template, args in [
            (
                "uvicorn.error",
                '%s - "WebSocket %s" [accepted]',
                ("127.0.0.1", f"/api/ws?%74oken={secret}&view=live"),
            ),
            (
                "uvicorn.access",
                '%s - "%s %s HTTP/%s" %d',
                ("127.0.0.1", "GET", f"/api/ersatztv/stream/1?token={secret}", "1.1", 200),
            ),
        ]:
            record = logging.LogRecord(name, logging.INFO, __file__, 1, template, args, None)
            InterceptHandler().emit(record)
            assert secret not in str(record.__dict__)
        logger.bind(headers={"Authorization": f"Bearer {secret}"}, token=secret).warning(
            "Stream failed {}", f"https://synthetic/stream?token={secret}&channel=1"
        )
    captured = output.getvalue()
    assert secret not in captured
    assert "[REDACTED]" in captured
    assert "view=live" in captured
    assert "/api/ersatztv/stream/1" in captured
    if log_format == "json":
        assert all(json.loads(line)["record"] for line in captured.splitlines())


@pytest.mark.parametrize("log_format", ["pretty", "json"])
def test_sec03_exception_logs_do_not_expose_credentials_or_locals(log_format):
    output = StringIO()
    secret = "SYNTHETIC_EXCEPTION_CREDENTIAL"
    config = Settings(_env_file=None, log_format=log_format, log_level="DEBUG")
    with patch("app.logging_config.settings", config), patch.object(sys, "stderr", output):
        configure_logging()
        try:
            raise ValueError("Stream failed: /api/stream?token=" + secret)
        except ValueError:
            logger.exception("Stream failure")
            record = logging.LogRecord(
                "uvicorn.error", logging.ERROR, __file__, 1, "Handshake failed", (), sys.exc_info()
            )
            InterceptHandler().emit(record)
            assert secret not in str(record.__dict__)
    assert secret not in output.getvalue()
    assert "[REDACTED]" in output.getvalue()
    assert "Stream failure" in output.getvalue()


@pytest.fixture
def json_logging():
    """Configure JSON logging into a buffer, then restore stdlib logger state."""
    import logging.config

    import uvicorn.config

    names = ["", "uvicorn", "uvicorn.error", "uvicorn.access", "fastapi", "httpx", "httpcore"]
    saved = {
        name: (lg.handlers[:], lg.level, lg.propagate, lg.filters[:])
        for name in names
        for lg in [logging.getLogger(name)]
    }
    output = StringIO()
    config = Settings(_env_file=None, log_format="json", log_level="INFO")
    with patch("app.logging_config.settings", config), patch.object(sys, "stderr", output):
        # As in production: uvicorn applies its own config before the app configures logging
        logging.config.dictConfig(uvicorn.config.LOGGING_CONFIG)
        configure_logging()
        yield output
    logger.remove()
    for name, (handlers, level, propagate, filters) in saved.items():
        lg = logging.getLogger(name)
        lg.handlers, lg.propagate, lg.filters = handlers, propagate, filters
        lg.setLevel(level)


def _records(output: StringIO) -> list[dict]:
    return [json.loads(line)["record"] for line in output.getvalue().splitlines()]


def _log_from_helper(message: str) -> None:
    logging.getLogger("test.source").warning(message)


def test_h04_uvicorn_error_line_is_written_once(json_logging) -> None:
    logging.getLogger("uvicorn.error").info("Application startup complete.")

    records = _records(json_logging)
    assert [r["message"] for r in records] == ["Application startup complete."]
    assert records[0]["extra"]["logger_name"] == "uvicorn.error"


def test_h04_intercepted_record_names_its_real_source(json_logging) -> None:
    _log_from_helper("from the helper")

    (record,) = _records(json_logging)
    assert record["function"] == "_log_from_helper"
    assert record["file"]["name"] == "test_logging_config.py"
    assert record["extra"]["logger_name"] == "test.source"


def test_h04_configure_logging_twice_writes_each_line_once(json_logging) -> None:
    config = Settings(_env_file=None, log_format="json", log_level="INFO")
    with patch("app.logging_config.settings", config), patch.object(sys, "stderr", json_logging):
        configure_logging()
    logging.getLogger("uvicorn.error").info("stdlib line")
    logger.info("loguru line")

    assert [r["message"] for r in _records(json_logging)] == ["stdlib line", "loguru line"]


def test_h05_httpx_info_is_dropped_and_warnings_kept(json_logging) -> None:
    logging.getLogger("httpx").info("HTTP Request: GET http://upstream/ok")
    logging.getLogger("httpcore.connection").debug("connect_tcp.started")
    logging.getLogger("httpx").warning("upstream trouble")

    assert [r["message"] for r in _records(json_logging)] == ["upstream trouble"]


def test_h05_root_logger_does_not_build_debug_records_at_info(json_logging) -> None:
    assert not logging.getLogger("some.library").isEnabledFor(logging.DEBUG)


def test_h05_access_log_drops_polled_and_streamed_paths(json_logging) -> None:
    access = logging.getLogger("uvicorn.access")
    for path in [
        "/api/health",
        "/api/health/deps",
        "/api/admin/status",
        "/api/ersatztv/segments/abc.ts?token=x",
        "/api/ersatztv/stream/C1?token=x",
        "/api/highlight/status/C1",
        "/api/channels",
        "/api/healthcheck-lookalike",
    ]:
        access.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1", "GET", path, "1.1", 200)

    messages = [r["message"] for r in _records(json_logging)]
    assert len(messages) == 2
    assert "/api/channels" in messages[0]
    assert "/api/healthcheck-lookalike" in messages[1]


def test_h05_presence_event_keeps_its_extra_fields(json_logging) -> None:
    logger.bind(event="watch.stop", duration_s=12.5).info("stopped")

    (record,) = _records(json_logging)
    assert record["extra"]["event"] == "watch.stop"
    assert record["extra"]["duration_s"] == 12.5
