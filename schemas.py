from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AssetCreate(BaseModel):
    """Validated payload for registering an infrastructure asset."""

    name: str = Field(min_length=1, max_length=120)
    asset_type: Literal["Bridge", "Road", "Flyover"]
    construction_year: int = Field(gt=0)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name must contain visible characters")
        return normalized
