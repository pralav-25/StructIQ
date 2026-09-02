import random
from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import database  # Assumes database.py contains Asset and Report models
from scoring import calculate_health, maintenance_priority

# 1. INITIALIZE APP
app = FastAPI(title="StructIQ AI Engine : Chennai")

# 2. CORS CONFIGURATION
# Allows your HTML files to talk to this Python server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. DATABASE INITIALIZATION
database.Base.metadata.create_all(bind=database.engine)

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 4. REQUEST SCHEMAS
class AssetCreate(BaseModel):
    name: str
    asset_type: str
    construction_year: int
    latitude: float
    longitude: float

# 5. API ENDPOINTS

@app.get("/assets")
def get_assets(db: Session = Depends(get_db)):
    """Fetches all assets for the Map and Sidebar."""
    return db.query(database.Asset).all()

@app.get("/reports")
def get_reports(db: Session = Depends(get_db)):
    """Fetches all citizen reports for the Incident Feed."""
    return db.query(database.Report).all()

@app.post("/assets")
def create_asset(asset: AssetCreate, db: Session = Depends(get_db)):
    """Manually adds a new asset with age-calculated health."""
    try:
        calculated_age, final_score, prio = calculate_health(
            asset.asset_type,
            asset.construction_year,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    new_asset = database.Asset(
        name=asset.name, 
        asset_type=asset.asset_type, 
        age=calculated_age,
        construction_year=asset.construction_year, 
        latitude=asset.latitude,
        longitude=asset.longitude, 
        health_score=float(final_score),
        maintenance_priority=prio, 
        vibration_level=round(random.uniform(0.01, 0.08), 3)
    )
    db.add(new_asset)
    db.commit()
    db.refresh(new_asset)
    return new_asset

@app.post("/reports/upload-ai")
async def upload_ai_report(
    asset_id: int = Form(...), 
    description: str = Form(...), 
    file: UploadFile = File(...), 
    db: Session = Depends(get_db)
):
    """Simulates image-based crack triage for the prototype workflow."""
    filename_check = (file.filename or "").lower()
    if any(word in filename_check for word in ["google", "download", "stock", "wallpaper"]):
        raise HTTPException(status_code=400, detail="FRAUD DETECTED: Image source is not original.")

    asset = db.query(database.Asset).filter(database.Asset.id == asset_id).first()
    if not asset: raise HTTPException(status_code=404, detail="Asset ID not found.")

    # Prototype-only simulation. Replace with a validated model before real use.
    ai_severity = random.choice([5, 10, 15])
    labels = {5: "Minor Hairline", 10: "Significant Surface", 15: "Critical Structural"}
    ai_label = labels[ai_severity]
    
    new_report = database.Report(
        asset_id=asset_id,
        description=f"AI SCAN [{ai_label}]: {description}",
        severity=ai_severity,
        status="Open"
    )
    
    # AI Impact: Reduce health based on severity
    asset.health_score = max(0.0, asset.health_score - (ai_severity * 1.5))
    asset.maintenance_priority = maintenance_priority(asset.health_score)
    
    db.add(new_report)
    db.commit()
    db.refresh(new_report)
    return {"report_id": new_report.id, "analysis": ai_label, "severity": ai_severity}

@app.post("/weather/trigger-flood")
def trigger_flood_alert(db: Session = Depends(get_db)):
    """Simulates monsoon impact on Chennai Roads."""
    roads = db.query(database.Asset).filter(database.Asset.asset_type == "Road").all()
    for road in roads:
        road.health_score = max(0.0, road.health_score - 15.0)
        road.maintenance_priority = maintenance_priority(road.health_score)
    db.commit()
    return {"status": "FLOOD ALERT ACTIVE", "affected_count": len(roads)}

@app.post("/reports/{report_id}/resolve")
def resolve_report(report_id: int, db: Session = Depends(get_db)):
    """Deletes a report and restores health."""
    report = db.query(database.Report).filter(database.Report.id == report_id).first()
    if not report: raise HTTPException(status_code=404)
    
    asset = db.query(database.Asset).filter(database.Asset.id == report.asset_id).first()
    if asset:
        asset.health_score = min(100, asset.health_score + (report.severity * 1.5))
        asset.maintenance_priority = maintenance_priority(asset.health_score)
    
    db.delete(report)
    db.commit()
    return {"status": "success"}

@app.post("/assets/{asset_id}/maintenance")
def perform_maintenance(asset_id: int, db: Session = Depends(get_db)):
    """FEATURE: Admin manually boosts health after repair."""
    asset = db.query(database.Asset).filter(database.Asset.id == asset_id).first()
    if not asset: raise HTTPException(status_code=404)

    asset.health_score = min(100.0, asset.health_score + 20.0)
    asset.maintenance_priority = maintenance_priority(asset.health_score)
    
    db.commit()
    return {"new_health": asset.health_score, "status": "Maintenance logged"}

# --- JUDGES DEMO SETUP ROUTE ---
@app.get("/setup-demo")
def setup_demo(db: Session = Depends(get_db)):
    """Seeds the database with 9 realistic Chennai landmarks."""
    demo_assets = [
        {"name": "Adyar Bridge", "asset_type": "Bridge", "latitude": 13.0067, "longitude": 80.2595, "construction_year": 1970},
        {"name": "Napier Bridge", "asset_type": "Bridge", "latitude": 13.0694, "longitude": 80.2824, "construction_year": 1869},
        {"name": "Ennore Creek Bridge", "asset_type": "Bridge", "latitude": 13.2217, "longitude": 80.3222, "construction_year": 2005},
        {"name": "Anna Flyover", "asset_type": "Flyover", "latitude": 13.0500, "longitude": 80.2500, "construction_year": 1973},
        {"name": "Kathipara Cloverleaf", "asset_type": "Flyover", "latitude": 13.0067, "longitude": 80.2050, "construction_year": 2008},
        {"name": "T.Nagar Skywalk", "asset_type": "Flyover", "latitude": 13.0333, "longitude": 80.2333, "construction_year": 2022},
        {"name": "OMR IT Expressway", "asset_type": "Road", "latitude": 12.9228, "longitude": 80.2316, "construction_year": 2006},
        {"name": "ECR Highway", "asset_type": "Road", "latitude": 12.8491, "longitude": 80.2433, "construction_year": 1998},
        {"name": "Mount Road", "asset_type": "Road", "latitude": 13.0600, "longitude": 80.2500, "construction_year": 1950}
    ]

    for data in demo_assets:
        existing = db.query(database.Asset).filter(database.Asset.name == data["name"]).first()
        if not existing:
            age, h_score, prio = calculate_health(
                data["asset_type"],
                data["construction_year"],
            )

            demo_floor = 15.0 if data["asset_type"] == "Road" else 20.0
            h_score = max(demo_floor, h_score)
            prio = maintenance_priority(h_score)

            # Demo exception: Napier is old but represented as well maintained.
            if data["name"] == "Napier Bridge":
                h_score = 92.5
                prio = maintenance_priority(h_score)

            new_asset = database.Asset(
                **data, age=age, health_score=round(h_score, 1),
                maintenance_priority=prio, vibration_level=0.02
            )
            db.add(new_asset)
    
    db.commit()
    return {"status": "Demo assets loaded successfully", "count": 9}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
