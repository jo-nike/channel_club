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


class ClientMessage(BaseModel):
    model_config = ConfigDict(strict=True)


class PingMessage(ClientMessage):
    type: Literal["ping"]


class ChannelUpdateMessage(ClientMessage):
    type: Literal["channel_update"]
    channel: PresenceText | None = None
    programme: PresenceText | None = None
    view: Literal["live", "ersatztv"] | None = None


class NicknameMessage(ClientMessage):
    type: Literal["set_nickname"]
    nickname: InputText = ""


class ChatMessage(ClientMessage):
    type: Literal["chat_message"]
    content: InputText = ""


client_message_adapter = TypeAdapter(
    Annotated[
        PingMessage | ChannelUpdateMessage | NicknameMessage | ChatMessage,
        Field(discriminator="type"),
    ]
)
