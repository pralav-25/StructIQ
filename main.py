"""StructIQ: an infrastructure maintenance workflow demonstration."""

import csv
import io
import os
import secrets
import warnings
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

import database as dbm
from schemas import ArchiveState, AssetCreate, Credentials, Note, Registration, Scenario
from scoring import calculate_health, maintenance_priority
from security import check_password, hash_password, token_hash
from seed import seed_workspace

ROOT = Path(__file__).parent
COOKIE = "structiq_session"
MAX_UPLOAD = 3 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16_000_000
DUMMY_PASSWORD = hash_password(secrets.token_urlsafe(20))


@asynccontextmanager
async def lifespan(_app):
    with dbm.engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(729601341)"))
        dbm.Base.metadata.create_all(connection)
    yield


app = FastAPI(
    title="StructIQ",
    version="1.0.0",
    lifespan=lifespan,
    description="Private workspaces for a demonstration maintenance workflow. Scores are illustrative, not engineering assessments.",
)


@app.middleware("http")
async def protect_requests(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("x-requested-with") != "StructIQ":
            return JSONResponse(
                {"detail": "Use the StructIQ application to submit this request."}, status_code=403
            )
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > MAX_UPLOAD + 65536):
            return JSONResponse(
                {"detail": "Request exceeds the 3 MB upload limit."}, status_code=413
            )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def get_db():
    with dbm.SessionLocal() as db:
        yield db


def workspace(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE, "")
    session = db.get(dbm.LoginSession, token_hash(token)) if token else None
    if not session or session.expires_at <= dbm.utcnow():
        raise HTTPException(401, "Your session has expired. Sign in or start a new demo.")
    account = db.get(dbm.Workspace, session.workspace_id)
    if not account or (account.is_demo and account.created_at < dbm.utcnow() - timedelta(days=7)):
        raise HTTPException(401, "This demo has expired. Start a new workspace.")
    return account


def public_workspace(share_token, db):
    account = db.query(dbm.Workspace).filter_by(share_token=share_token).first()
    if not account or (account.is_demo and account.created_at < dbm.utcnow() - timedelta(days=7)):
        raise HTTPException(404, "This reporting link is unavailable.")
    return account


def limited(request, db, action, maximum, seconds=3600):
    """Atomic persistent limits; production headers are set by the hosting proxy."""
    address = request.client.host if request.client else "unknown"
    if os.getenv("VERCEL"):
        address = request.headers.get("x-vercel-forwarded-for", address).split(",")[0].strip()
    now = dbm.utcnow()
    bucket = int(now.timestamp()) // seconds
    key = f"{action}:{token_hash(address)[:32]}:{bucket}"
    insert_module = __import__(f"sqlalchemy.dialects.{db.bind.dialect.name}", fromlist=["insert"])
    statement = insert_module.insert(dbm.RequestLimit).values(
        key=key, count=1, expires_at=now + timedelta(seconds=seconds * 2)
    )
    statement = statement.on_conflict_do_update(
        index_elements=["key"], set_={"count": dbm.RequestLimit.count + 1}
    ).returning(dbm.RequestLimit.count)
    count = db.execute(statement).scalar_one()
    db.query(dbm.RequestLimit).filter(dbm.RequestLimit.expires_at < now).delete()
    db.commit()
    if count > maximum:
        raise HTTPException(
            429, "Too many requests. Please try again later.", headers={"Retry-After": str(seconds)}
        )


def account_data(account):
    return {
        "name": account.name,
        "username": None if account.is_demo else account.username,
        "is_demo": account.is_demo,
        "share_token": account.share_token,
        "flood_active": account.flood_active,
    }


def start_session(db, account):
    token = secrets.token_urlsafe(32)
    days = 7 if account.is_demo else 30
    db.add(
        dbm.LoginSession(
            token_hash=token_hash(token),
            workspace_id=account.id,
            expires_at=dbm.utcnow() + timedelta(days=days),
        )
    )
    db.commit()
    response = JSONResponse(account_data(account))
    response.set_cookie(
        COOKIE,
        token,
        max_age=days * 86400,
        httponly=True,
        secure=bool(os.getenv("VERCEL")),
        samesite="lax",
        path="/",
    )
    return response


def activity(db, account, kind, message, asset=None):
    db.flush()
    db.add(
        dbm.Activity(
            workspace_id=account.id,
            kind=kind,
            message=message,
            asset_id=asset.id if asset else None,
            health_score=asset_score(db, account, asset) if asset else None,
        )
    )


def asset_score(db, account, asset):
    severity = (
        db.query(func.coalesce(func.sum(dbm.Report.severity), 0))
        .filter_by(workspace_id=account.id, asset_id=asset.id, status="Open")
        .scalar()
    )
    flood = 15 if account.flood_active and asset.asset_type == "Road" else 0
    return round(max(0.0, asset.condition_score - severity * 1.5 - flood), 1)


def owned_asset(db, account, asset_id, include_archived=False):
    asset = (
        db.query(dbm.Asset)
        .filter_by(id=asset_id, workspace_id=account.id)
        .with_for_update()
        .first()
    )
    if not asset or (asset.archived and not include_archived):
        raise HTTPException(404, "Asset not found.")
    return asset


def asset_data(db, account, asset):
    score = asset_score(db, account, asset)
    return {
        "id": asset.id,
        "name": asset.name,
        "asset_type": asset.asset_type,
        "construction_year": asset.construction_year,
        "age": dbm.utcnow().year - asset.construction_year,
        "latitude": asset.latitude,
        "longitude": asset.longitude,
        "health_score": score,
        "condition_score": round(asset.condition_score, 1),
        "maintenance_priority": maintenance_priority(score),
        "archived": asset.archived,
        "last_service_at": iso(asset.last_service_at),
        "created_at": iso(asset.created_at),
    }


def iso(value):
    return value.isoformat() + "Z" if value else None


def report_data(db, report):
    asset = report.asset
    return {
        "id": report.id,
        "asset_id": report.asset_id,
        "asset_name": asset.name if asset else "Archived asset",
        "description": report.description,
        "severity": report.severity,
        "status": report.status,
        "tracking_code": report.tracking_code,
        "has_image": bool(report.has_image),
        "resolution_note": report.resolution_note,
        "created_at": iso(report.created_at),
        "resolved_at": iso(report.resolved_at),
    }


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "database": "postgresql" if db.bind.dialect.name == "postgresql" else "sqlite",
        "version": "1.0.0",
    }


@app.post("/api/auth/register")
def register(payload: Registration, request: Request, db: Session = Depends(get_db)):
    limited(request, db, "register", 5)
    account = dbm.Workspace(
        username=payload.username,
        name=payload.name,
        password_hash=hash_password(payload.password),
        share_token=secrets.token_urlsafe(24),
    )
    db.add(account)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409, "That username is already in use. Choose another or sign in."
        ) from None
    seed_workspace(db, account)
    activity(db, account, "workspace", "Workspace created with nine illustrative Chennai assets.")
    return start_session(db, account)


@app.post("/api/auth/demo")
def demo(request: Request, db: Session = Depends(get_db)):
    limited(request, db, "demo", 8)
    # Demo retention is shown before creation. Registered workspaces are never removed here.
    db.query(dbm.Workspace).filter(
        dbm.Workspace.is_demo.is_(True), dbm.Workspace.created_at < dbm.utcnow() - timedelta(days=7)
    ).delete()
    account = dbm.Workspace(
        username="demo_" + secrets.token_hex(10),
        name="Chennai demo workspace",
        is_demo=True,
        share_token=secrets.token_urlsafe(24),
    )
    db.add(account)
    db.flush()
    seed_workspace(db, account)
    activity(db, account, "workspace", "Private demo created. All scores are illustrative.")
    return start_session(db, account)


@app.post("/api/auth/login")
def login(payload: Credentials, request: Request, db: Session = Depends(get_db)):
    limited(request, db, "login", 15, 900)
    account = db.query(dbm.Workspace).filter_by(username=payload.username, is_demo=False).first()
    valid = check_password(payload.password, account.password_hash if account else DUMMY_PASSWORD)
    if not account or not valid:
        raise HTTPException(401, "Username or password is incorrect.")
    return start_session(db, account)


@app.get("/api/auth/me")
def current_account(account=Depends(workspace)):
    return account_data(account)


@app.post("/api/auth/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE, "")
    db.query(dbm.LoginSession).filter_by(token_hash=token_hash(token)).delete()
    db.commit()
    response = JSONResponse({"status": "signed_out"})
    response.delete_cookie(COOKIE, path="/")
    return response


@app.get("/assets", include_in_schema=False)
@app.get("/api/assets")
def assets(archived: bool = False, account=Depends(workspace), db: Session = Depends(get_db)):
    return [
        asset_data(db, account, a)
        for a in db.query(dbm.Asset)
        .filter_by(workspace_id=account.id, archived=archived)
        .order_by(dbm.Asset.id)
    ]


@app.post("/assets", include_in_schema=False)
@app.post("/api/assets", status_code=201)
def create_asset(payload: AssetCreate, account=Depends(workspace), db: Session = Depends(get_db)):
    if db.query(dbm.Asset).filter_by(workspace_id=account.id).count() >= 100:
        raise HTTPException(409, "This workspace has reached its 100-asset limit.")
    _, score, _ = calculate_health(payload.asset_type, payload.construction_year)
    asset = dbm.Asset(**payload.model_dump(), workspace_id=account.id, condition_score=score)
    db.add(asset)
    activity(db, account, "asset", f"Registered {asset.name}.", asset)
    db.commit()
    return asset_data(db, account, asset)


@app.put("/api/assets/{asset_id}")
def update_asset(
    asset_id: int, payload: AssetCreate, account=Depends(workspace), db: Session = Depends(get_db)
):
    asset = owned_asset(db, account, asset_id)
    if (payload.asset_type, payload.construction_year) != (
        asset.asset_type,
        asset.construction_year,
    ):
        _, asset.condition_score, _ = calculate_health(
            payload.asset_type, payload.construction_year
        )
    for key, value in payload.model_dump().items():
        setattr(asset, key, value)
    activity(db, account, "asset", f"Updated registration details for {asset.name}.", asset)
    db.commit()
    return asset_data(db, account, asset)


@app.patch("/api/assets/{asset_id}/archive")
def archive_asset(
    asset_id: int, payload: ArchiveState, account=Depends(workspace), db: Session = Depends(get_db)
):
    asset = owned_asset(db, account, asset_id, include_archived=True)
    if (
        payload.archived
        and db.query(dbm.Report).filter_by(asset_id=asset.id, status="Open").count()
    ):
        raise HTTPException(409, "Resolve this asset’s open reports before archiving it.")
    if asset.archived != payload.archived:
        asset.archived = payload.archived
        activity(
            db,
            account,
            "asset",
            f"{'Archived' if payload.archived else 'Restored'} {asset.name}.",
            asset,
        )
    db.commit()
    return {"archived": asset.archived}


@app.post("/assets/{asset_id}/maintenance", include_in_schema=False)
@app.post("/api/assets/{asset_id}/maintenance")
def maintain_asset(
    asset_id: int, payload: Note, account=Depends(workspace), db: Session = Depends(get_db)
):
    asset = owned_asset(db, account, asset_id)
    asset.condition_score = min(100.0, asset.condition_score + 20.0)
    asset.last_service_at = dbm.utcnow()
    activity(db, account, "maintenance", f"Maintenance on {asset.name}: {payload.note}", asset)
    db.commit()
    return asset_data(db, account, asset)


@app.get("/api/activity")
def events(account=Depends(workspace), db: Session = Depends(get_db)):
    rows = (
        db.query(dbm.Activity)
        .filter_by(workspace_id=account.id)
        .order_by(dbm.Activity.id.desc())
        .limit(100)
    )
    return [
        {
            "id": a.id,
            "kind": a.kind,
            "message": a.message,
            "asset_id": a.asset_id,
            "health_score": a.health_score,
            "created_at": iso(a.created_at),
        }
        for a in rows
    ]


@app.get("/reports", include_in_schema=False)
@app.get("/api/reports")
def reports(
    status: str | None = Query(None, pattern="^(Open|Resolved)$"),
    account=Depends(workspace),
    db: Session = Depends(get_db),
):
    query = (
        db.query(dbm.Report)
        .options(selectinload(dbm.Report.asset))
        .filter_by(workspace_id=account.id)
    )
    if status:
        query = query.filter_by(status=status)
    return [report_data(db, r) for r in query.order_by(dbm.Report.id.desc())]


async def verified_image(file):
    if not file or not file.filename:
        return None
    try:
        if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(415, "Attach a JPEG, PNG, or WebP image.")
        content = await file.read(MAX_UPLOAD + 1)
        if not content:
            raise HTTPException(422, "The image is empty.")
        if len(content) > MAX_UPLOAD:
            raise HTTPException(413, "Image exceeds the 3 MB limit.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise HTTPException(415, "The file is not a supported image.")
                source.verify()
            with Image.open(io.BytesIO(content)) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((1400, 1400))
                output = io.BytesIO()
                image.save(output, "JPEG", quality=75, optimize=True)
                result = output.getvalue()
                if len(result) > 600_000:
                    raise HTTPException(413, "Please choose a smaller image.")
                return result
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise HTTPException(422, "The attachment could not be verified as a valid image.") from None
    finally:
        await file.close()


async def save_report(account, db, request, asset_id, description, severity, file):
    limited(request, db, "report", 20)
    asset = owned_asset(db, account, asset_id)
    description = description.strip()
    if not description:
        raise HTTPException(422, "Describe the issue before submitting.")
    cap = 50 if account.is_demo else 200
    if db.query(dbm.Report).filter_by(workspace_id=account.id).count() >= cap:
        raise HTTPException(409, f"This workspace has reached its {cap}-report limit.")
    image = await verified_image(file)
    report = dbm.Report(
        workspace_id=account.id,
        asset_id=asset.id,
        description=description,
        severity=int(severity),
        tracking_code=secrets.token_urlsafe(16),
        image=image,
    )
    db.add(report)
    activity(
        db,
        account,
        "report",
        f"New { {5: 'low', 10: 'medium', 15: 'high'}[int(severity)] }-priority report for {asset.name}.",
        asset,
    )
    db.commit()
    return report_data(db, report)


@app.post("/api/reports", status_code=201)
async def submit_report(
    request: Request,
    asset_id: int = Form(...),
    description: str = Form(..., min_length=1, max_length=2000),
    severity: Literal["5", "10", "15"] = Form(...),
    file: UploadFile | None = File(None),
    account=Depends(workspace),
    db: Session = Depends(get_db),
):
    return await save_report(account, db, request, asset_id, description, severity, file)


@app.post("/reports/{report_id}/resolve", include_in_schema=False)
@app.post("/api/reports/{report_id}/resolve")
def resolve_report(
    report_id: int, payload: Note, account=Depends(workspace), db: Session = Depends(get_db)
):
    report = (
        db.query(dbm.Report)
        .filter_by(id=report_id, workspace_id=account.id)
        .with_for_update()
        .first()
    )
    if not report:
        raise HTTPException(404, "Report not found.")
    if report.status == "Resolved":
        return {**report_data(db, report), "already_resolved": True}
    report.status, report.resolution_note, report.resolved_at = (
        "Resolved",
        payload.note,
        dbm.utcnow(),
    )
    asset = owned_asset(db, account, report.asset_id, include_archived=True)
    activity(
        db,
        account,
        "resolution",
        f"Resolved report #{report.id} for {asset.name}: {payload.note}",
        asset,
    )
    db.commit()
    return {**report_data(db, report), "already_resolved": False}


@app.get("/api/reports/{report_id}/image")
def report_image(report_id: int, account=Depends(workspace), db: Session = Depends(get_db)):
    report = db.query(dbm.Report).filter_by(id=report_id, workspace_id=account.id).first()
    if not report or not report.image:
        raise HTTPException(404, "Attachment not found.")
    return Response(
        report.image,
        media_type="image/jpeg",
        headers={"Content-Disposition": "inline; filename=evidence.jpg"},
    )


@app.post("/api/scenarios/flood")
def scenario(payload: Scenario, account=Depends(workspace), db: Session = Depends(get_db)):
    account = db.query(dbm.Workspace).filter_by(id=account.id).with_for_update().one()
    changed = account.flood_active != payload.active
    account.flood_active = payload.active
    if changed:
        activity(
            db,
            account,
            "scenario",
            "Flood scenario enabled: road scores carry a 15-point demonstration penalty."
            if payload.active
            else "Flood scenario cleared: road penalties removed.",
        )
    db.commit()
    return {"active": account.flood_active, "changed": changed}


@app.post("/setup-demo", include_in_schema=False)
@app.post("/api/setup-demo")
def seed(account=Depends(workspace), db: Session = Depends(get_db)):
    # Serialize repeated seed requests within this workspace.
    account = db.query(dbm.Workspace).filter_by(id=account.id).with_for_update().one()
    count = seed_workspace(db, account)
    if count:
        activity(db, account, "workspace", f"Added {count} missing example assets.")
    db.commit()
    return {"added": count}


@app.get("/api/public/{share_token}/assets")
def public_assets(share_token: str, db: Session = Depends(get_db)):
    account = public_workspace(share_token, db)
    return {
        "workspace": account.name,
        "assets": [
            {"id": a.id, "name": a.name, "asset_type": a.asset_type}
            for a in db.query(dbm.Asset).filter_by(workspace_id=account.id, archived=False)
        ],
    }


@app.post("/api/public/{share_token}/reports", status_code=201)
async def public_report(
    share_token: str,
    request: Request,
    asset_id: int = Form(...),
    description: str = Form(..., min_length=1, max_length=2000),
    severity: Literal["5", "10", "15"] = Form(...),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    account = public_workspace(share_token, db)
    report = await save_report(account, db, request, asset_id, description, severity, file)
    return {key: report[key] for key in ["id", "tracking_code", "status", "created_at"]}


@app.get("/api/track/{tracking_code}")
def track(tracking_code: str, request: Request, db: Session = Depends(get_db)):
    limited(request, db, "tracking", 60, 60)
    report = db.query(dbm.Report).filter_by(tracking_code=tracking_code).first()
    if not report:
        raise HTTPException(404, "Report not found. Check the tracking link.")
    owner = db.get(dbm.Workspace, report.workspace_id)
    if not owner or (owner.is_demo and owner.created_at < dbm.utcnow() - timedelta(days=7)):
        raise HTTPException(404, "This report has expired.")
    asset = report.asset
    return {
        "id": report.id,
        "asset_name": asset.name,
        "status": report.status,
        "created_at": iso(report.created_at),
        "resolved_at": iso(report.resolved_at),
    }


@app.get("/api/export")
def export(account=Depends(workspace), db: Session = Depends(get_db)):
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(
        [
            "ID",
            "Asset",
            "Type",
            "Construction year",
            "Latitude",
            "Longitude",
            "Demo health score",
            "Priority",
            "Last maintenance",
        ]
    )
    for asset in db.query(dbm.Asset).filter_by(workspace_id=account.id, archived=False):
        data = asset_data(db, account, asset)
        name = asset.name
        if name.lstrip().startswith(("=", "+", "-", "@")) or name.startswith(("\t", "\r", "\n")):
            name = "'" + name
        writer.writerow(
            [
                asset.id,
                name,
                asset.asset_type,
                asset.construction_year,
                asset.latitude,
                asset.longitude,
                data["health_score"],
                data["maintenance_priority"],
                data["last_service_at"] or "",
            ]
        )
    return Response(
        stream.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="structiq-assets.csv"'},
    )


@app.get("/", include_in_schema=False)
@app.get("/app", include_in_schema=False)
@app.get("/report/{share_token}", include_in_schema=False)
@app.get("/track/{tracking_code}", include_in_schema=False)
def page():
    return FileResponse(ROOT / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/auth.html", include_in_schema=False)
def old_dashboard():
    return RedirectResponse("/app")


@app.get("/home.html", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
def old_home():
    return RedirectResponse("/")


# Vercel serves public files directly; this mount provides the same paths locally.
app.mount(
    "/static", StaticFiles(directory=ROOT / "public" / "static", check_dir=False), name="static"
)
