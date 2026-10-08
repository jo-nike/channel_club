"""Validated client messages, and the typed messages the server sends back.

Invalid client messages receive an invalid_message error. Unknown message types
remain ignored for forward compatibility. String input is bounded before
presence/chat mutations; chat and nickname display truncation is retained
within the 16 KiB wire-message budget.

Server messages are the models in ServerMessage, and server_payload() is the
only way one becomes JSON (tests/test_ws_contract.py pins every payload, and
frontend/src/types/ws.ts mirrors them).
"""

from typing import Annotated, Any, Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from app.models.admin import AppSettings
from app.models.channel import Channel

MAX_MESSAGE_BYTES = 16 * 1024
PresenceText = Annotated[str, Field(strict=True, max_length=512)]
InputText = Annotated[str, Field(strict=True, max_length=4096)]
ClientMessageId = Annotated[str, Field(strict=True, min_length=1, max_length=64)]

# Defined once here: the services build the server messages below from them.
View = Literal["live", "ersatztv"]
# 'user' is a member's message, 'system' a line the server posts about a shared
# event (someone changing Live), 'share' a now-playing card, 'suggestion' a
# member asking for a channel on live TV
MessageKind = Literal["user", "system", "share", "suggestion"]


class ClientMessage(BaseModel):
    model_config = ConfigDict(strict=True)


class PingMessage(ClientMessage):
    type: Literal["ping"]


class ChannelUpdateMessage(ClientMessage):
    type: Literal["channel_update"]
    channel: PresenceText | None = None
    channelId: PresenceText | None = None
    programme: PresenceText | None = None
    view: View | None = None
    onLive: bool | None = None  # Following the shared Live slot; pre-R2 bundles omit it


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
    """The first frame on a new socket: the session token, kept out of the URL.

    hideActivity comes with it, so a person who hides what they watch is
    tracked as hidden before their first channel_update can be shown.
    """

    type: Literal["auth"]
    token: InputText
    hideActivity: bool = False


class ReauthMessage(ClientMessage):
    """A refreshed token for the same account, moving the socket's expiry."""

    type: Literal["reauth"]
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


# Server-to-client messages. Field names are the camelCase keys on the wire.


def _is_none(value: object) -> bool:
    """exclude_if for optional keys left out of the payload, rather than sent as null."""
    return value is None


class PresenceEntry(TypedDict):
    """One person in the presence snapshot (camelCase, as sent to clients)."""

    userId: str | None
    displayName: str
    channelId: str | None
    channelName: str | None
    programme: str | None
    view: View | None
    since: str | None


class ChatLine(BaseModel):
    """A chat message as clients show it (chat.ChatMessage.to_dict)."""

    messageId: str
    username: str
    userId: str
    content: str
    timestamp: str
    kind: MessageKind
    channelId: str | None
    channelName: str | None
    programme: str | None
    view: View | None


class You(BaseModel):
    """Who the connection is signed in as."""

    username: str
    userId: str


class Sources(BaseModel):
    """Which channel sources have an address. A source without one has no
    channels, so clients leave out what it would fill (Live needs Dispatcharr)."""

    dispatcharr: bool
    ersatztv: bool


class Features(BaseModel):
    """Which optional features the server has on, so clients show only those."""

    chat: bool
    gif: bool
    nhl: bool
    sources: Sources


class ServerConnectionAck(BaseModel):
    type: Literal["connection_ack"]
    currentChannel: Channel | None
    settings: AppSettings
    you: You
    presence: list[PresenceEntry]
    buildId: str
    features: Features


class ServerChatHistory(BaseModel):
    type: Literal["chat_history"]
    messages: list[ChatLine]


class ServerChatMessage(ChatLine):
    type: Literal["chat_message"]


class ServerChatAck(BaseModel):
    type: Literal["chat_ack"]
    clientMessageId: str
    accepted: bool
    # Only on an accepted send
    messageId: str | None = Field(default=None, exclude_if=_is_none)


class ServerChannelUpdate(BaseModel):
    type: Literal["channel_update"]
    channel: Channel | None
    changedBy: str | None


class ServerSettingsUpdate(BaseModel):
    type: Literal["settings_update"]
    settings: AppSettings


class ServerFeaturesUpdate(BaseModel):
    """An optional feature switched on or off: chat, GIFs, NHL, clips or feedback.

    Chat, GIFs and NHL come as in connection_ack; clients read clips and
    feedback again from their /feature endpoints.
    """

    type: Literal["features_update"]
    features: Features


class ServerPresenceUpdate(BaseModel):
    type: Literal["presence_update"]
    presence: list[PresenceEntry]


class ServerPong(BaseModel):
    type: Literal["pong"]


class ServerError(BaseModel):
    type: Literal["error"]
    code: Literal["invalid_message", "rate_limited", "nickname_taken"]
    # The nickname as sent, on rate_limited and nickname_taken for set_nickname
    nickname: str | None = Field(default=None, exclude_if=_is_none)
    # On invalid_message, the request's own id when it sent a valid one (see echoed_client_id)
    clientMessageId: str | None = Field(default=None, exclude_if=_is_none)


ServerMessage = Annotated[
    ServerConnectionAck
    | ServerChatHistory
    | ServerChatMessage
    | ServerChatAck
    | ServerChannelUpdate
    | ServerSettingsUpdate
    | ServerFeaturesUpdate
    | ServerPresenceUpdate
    | ServerPong
    | ServerError,
    Field(discriminator="type"),
]
server_message_adapter: TypeAdapter[ServerMessage] = TypeAdapter(ServerMessage)
_client_message_id_adapter: TypeAdapter[str] = TypeAdapter(ClientMessageId)


def echoed_client_id(message: object) -> str | None:
    """The clientMessageId of a message that failed validation, if it is one the client could send.

    Only a string within the ClientMessageId bounds comes back, so an invalid
    message can't make the server echo anything else.
    """
    if not isinstance(message, dict):
        return None
    try:
        return _client_message_id_adapter.validate_python(message.get("clientMessageId"))
    except ValidationError:
        return None


def server_payload(message: ServerMessage) -> dict[str, Any]:
    """The JSON object a server message is sent as: nested models by alias, as clients read them."""
    return message.model_dump(mode="json", by_alias=True)
