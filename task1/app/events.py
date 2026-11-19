from datetime import datetime, timezone
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CallEvent(BaseModel):
    model_config = ConfigDict(strict=True)

    event_id: str
    event_type: Literal["call.started", "call.ended", "call.failed"]
    account_id: str = Field(pattern=r"^acct_[0-9]{3}$")
    call_id: str
    timestamp: datetime
    duration_seconds: int = Field(ge=0, le=2**31 - 1)
    cost_cents: int = Field(ge=0, le=2**63 - 1)
    destination_country: str

    @field_validator("timestamp", mode="before")
    @classmethod
    def parse_timestamp(cls, value: object) -> datetime:
        if not isinstance(value, str):
            raise ValueError("Timestamp must be an ISO 8601 string")
        timestamp = datetime.fromisoformat(value)
        if timestamp.tzinfo is None:
            raise ValueError("Timestamp must include a timezone")
        return timestamp.astimezone(timezone.utc)

    @field_validator("event_id", "call_id", "destination_country")
    @classmethod
    def check_database_text(cls, value: str) -> str:
        if "\0" in value:
            raise ValueError("Text must not contain a null character")
        value.encode("utf-8")  # Reject lone surrogate characters from JSON escapes.
        return value

    @model_validator(mode="after")
    def check_nonbillable_event(self) -> Self:
        if self.event_type != "call.ended" and (self.duration_seconds or self.cost_cents):
            raise ValueError("Started and failed events require zero duration and cost")
        return self
