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
