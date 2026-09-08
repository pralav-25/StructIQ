"""Persistent, isolated workspaces for the demonstration application."""

import os
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    create_engine,
    event,
)
from sqlalchemy.orm import column_property, declarative_base, deferred, relationship, sessionmaker
from sqlalchemy.pool import NullPool


def utcnow():
    return datetime.now(UTC).replace(tzinfo=None)


DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")
if not DATABASE_URL:
    if os.getenv("VERCEL"):
        raise RuntimeError("Connect a Postgres database before deploying this application.")
    Path(".data").mkdir(exist_ok=True)
    DATABASE_URL = "sqlite:///./.data/structiq.db"
if DATABASE_URL.startswith(("postgres://", "postgresql://")):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.split("://", 1)[1]
options = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    options["connect_args"] = {"check_same_thread": False, "timeout": 15}
else:
    options["poolclass"] = NullPool
engine = create_engine(DATABASE_URL, **options)
if DATABASE_URL.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Workspace(Base):
    __tablename__ = "workspaces"
    id = Column(Integer, primary_key=True)
    username = Column(String(32), unique=True, nullable=False)
    password_hash = Column(String(256))
    name = Column(String(80), nullable=False)
    share_token = Column(String(64), unique=True, nullable=False)
    is_demo = Column(Boolean, default=False, nullable=False)
    flood_active = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token_hash = Column(String(64), primary_key=True)
    workspace_id = Column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    expires_at = Column(DateTime, nullable=False, index=True)


class Asset(Base):
    __tablename__ = "workspace_assets"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(120), nullable=False)
    asset_type = Column(String(16), nullable=False)
    construction_year = Column(Integer, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    condition_score = Column(Float, nullable=False)
    archived = Column(Boolean, default=False, nullable=False)
    last_service_at = Column(DateTime)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class Report(Base):
    __tablename__ = "incident_reports"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id = Column(
        ForeignKey("workspace_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tracking_code = Column(String(48), nullable=False, unique=True)
    description = Column(String(2000), nullable=False)
    severity = Column(Integer, nullable=False)
    status = Column(String(16), default="Open", nullable=False)
    resolution_note = Column(String(1000))
    image = Column(LargeBinary)
    has_image = column_property(image.is_not(None))
    image = deferred(image)
    asset = relationship(Asset)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    resolved_at = Column(DateTime)


class Activity(Base):
    __tablename__ = "activity_events"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id = Column(ForeignKey("workspace_assets.id", ondelete="SET NULL"))
    kind = Column(String(24), nullable=False)
    message = Column(String(1500), nullable=False)
    health_score = Column(Float)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class RequestLimit(Base):
    __tablename__ = "request_limits"
    key = Column(String(100), primary_key=True)
    count = Column(Integer, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
