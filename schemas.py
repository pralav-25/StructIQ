from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AssetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=120)
    asset_type: Literal["Bridge", "Road", "Flyover"]
    construction_year: int = Field(gt=0)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value):
        if not value.strip():
            raise ValueError("Enter a visible name.")
        return value.strip()

    @field_validator("construction_year")
    @classmethod
    def validate_year(cls, value):
        if value > datetime.now().year:
            raise ValueError("Construction year cannot be in the future.")
        return value


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=10, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value):
        return value.lower()


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value):
        if not value.strip():
            raise ValueError("Enter a workspace name.")
        return value.strip()


class Note(BaseModel):
    note: str = Field(min_length=5, max_length=1000)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value):
        if len(value.strip()) < 5:
            raise ValueError("Describe the work in at least five characters.")
        return value.strip()


class Scenario(BaseModel):
    active: bool


class ArchiveState(BaseModel):
    archived: bool
