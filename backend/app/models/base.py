"""Base model for API models whose JSON names are the camelCase of their fields."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Fields are snake_case in Python and camelCase on the wire.

    The aliases are generated, not declared, so type checkers see the snake_case
    names as the constructor's parameters. Input is accepted under either name.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )
