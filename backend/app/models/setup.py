"""First-run setup models."""

from typing import Annotated, Literal

from pydantic import ConfigDict, Field

from app.models.base import CamelModel
from app.models.plex import PlexServer

# unclaimed: nobody has set up the club yet, and the first visitor to /setup
# becomes the admin. claimed: the admin exists and is still in the wizard.
# complete: setup is done, or auth comes from the environment.
SetupState = Literal["unclaimed", "claimed", "complete"]

# A sign-in name: 1-64 printable characters, not starting or ending with a space
USERNAME_PATTERN = r"^[^\s\x00-\x1f\x7f](?:[^\x00-\x1f\x7f]{0,62}[^\s\x00-\x1f\x7f])?$"
# The wizard's rule for passwords it sets
MIN_PASSWORD_LENGTH = 12
# plex.tv tokens become a header: printable ASCII only (see PlexAuthRequest)
PLEX_TOKEN_PATTERN = r"^[\x21-\x7e]+$"
MACHINE_ID_PATTERN = r"^[A-Za-z0-9_-]{1,128}$"


class EnvLock(CamelModel):
    """A variable the server's environment sets."""

    env: str
    # The setting it locks in the app (camelCase), or None when only the environment sets it
    field: str | None


class SetupStatusResponse(CamelModel):
    """Response for GET /api/setup/status. Public, so names only."""

    setup_state: SetupState
    # Listed only while setup is unclaimed
    env_locked: list[EnvLock]


class PlexAccount(CamelModel):
    """The plex.tv account a token belongs to, as the wizard shows it."""

    username: str


class PlexServersResponse(CamelModel):
    """Response for POST /api/setup/plex/servers."""

    account: PlexAccount
    servers: list[PlexServer]


class PasswordClaim(CamelModel):
    """Claim the club with a local admin account."""

    method: Literal["password"]
    username: str = Field(pattern=USERNAME_PATTERN)
    password: str = Field(max_length=256, min_length=MIN_PASSWORD_LENGTH)

    model_config = ConfigDict(extra="forbid")


class PlexClaim(CamelModel):
    """Claim the club with a Plex account and one of its own servers."""

    method: Literal["plex"]
    auth_token: str = Field(max_length=512, pattern=PLEX_TOKEN_PATTERN)
    machine_id: str = Field(pattern=MACHINE_ID_PATTERN)

    model_config = ConfigDict(extra="forbid")


# Body of POST /api/setup/account
SetupAccountRequest = Annotated[PasswordClaim | PlexClaim, Field(discriminator="method")]


class SetupFeatures(CamelModel):
    """Which extras are on when setup finishes."""

    chat: bool
    gifs: bool
    clips: bool
    cast: bool
    feedback: bool


class SetupCompleteResponse(CamelModel):
    """Response for POST /api/setup/complete: facts for the On air screen."""

    # None when the source isn't set up or didn't answer in time
    dispatcharr_channels: int | None
    ersatztv_channels: int | None
    # The Plex server whose members can join, when Plex sign-in is on
    plex_server_name: str | None
    features: SetupFeatures
