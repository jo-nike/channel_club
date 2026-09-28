"""Validated client messages. Invalid messages receive an invalid_message error.

Unknown message types remain ignored for forward compatibility. String input is
bounded before presence/chat mutations; chat and nickname display truncation is
retained within the 16 KiB wire-message budget.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

MAX_MESSAGE_BYTES = 16 * 1024
PresenceText = Annotated[str, Field(strict=True, max_length=512)]
InputText = Annotated[str, Field(strict=True, max_length=4096)]
ClientMessageId = Annotated[str, Field(strict=True, min_length=1, max_length=64)]


class ClientMessage(BaseModel):
    model_config = ConfigDict(strict=True)


class PingMessage(ClientMessage):
    type: Literal["ping"]


class ChannelUpdateMessage(ClientMessage):
    type: Literal["channel_update"]
    channel: PresenceText | None = None
    channelId: PresenceText | None = None
    programme: PresenceText | None = None
    view: Literal["live", "ersatztv"] | None = None


class NicknameMessage(ClientMessage):
    type: Literal["set_nickname"]
    nickname: InputText = ""


class PresencePrefsMessage(ClientMessage):
    type: Literal["set_presence_prefs"]
    hideActivity: bool


class ChatMessage(ClientMessage):
    type: Literal["chat_message"]
    content: InputText = ""
    clientMessageId: ClientMessageId | None = None


class ShareMessage(ClientMessage):
    """Share what I'm watching. Carries no channel: the server fills it from presence."""

    type: Literal["share"]
    clientMessageId: ClientMessageId | None = None


class SuggestMessage(ClientMessage):
    """Suggest a channel for live TV. Only its id: the server resolves the rest."""

    type: Literal["suggest"]
    channelId: PresenceText
    clientMessageId: ClientMessageId | None = None


class AuthMessage(ClientMessage):
    """The first frame on a new socket: the session token, kept out of the URL."""

    type: Literal["auth"]
    token: InputText


client_message_adapter = TypeAdapter(
    Annotated[
        PingMessage
        | ChannelUpdateMessage
        | NicknameMessage
        | PresencePrefsMessage
        | ChatMessage
        | ShareMessage
        | SuggestMessage,
        Field(discriminator="type"),
    ]
)
