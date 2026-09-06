"""Application identity from the project metadata shipped with every image."""

import tomllib
from pathlib import Path

APP_NAME = "Channel Club"
APP_TAGLINE = "Good TV. Better company."
APP_VERSION: str = tomllib.loads(
    (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text()
)["project"]["version"]
