"""Illustrative Chennai assets, never live infrastructure assessments."""

import database

EXAMPLES = [
    ("Adyar Bridge", "Bridge", 1970, 13.0067, 80.2595, 72.0),
    ("Napier Bridge", "Bridge", 1869, 13.0694, 80.2824, 92.5),
    ("Ennore Creek Bridge", "Bridge", 2005, 13.2217, 80.3222, 89.5),
    ("Anna Flyover", "Flyover", 1973, 13.0500, 80.2500, 73.5),
    ("Kathipara Junction", "Flyover", 2008, 13.0067, 80.2050, 91.0),
    ("T. Nagar Skywalk", "Flyover", 2022, 13.0333, 80.2333, 98.0),
    ("OMR IT Expressway", "Road", 2006, 12.9228, 80.2316, 40.0),
    ("East Coast Road", "Road", 1998, 12.8491, 80.2433, 35.0),
    ("Mount Road", "Road", 1950, 13.0600, 80.2500, 25.0),
]


def seed_workspace(db, workspace):
    added = 0
    for name, kind, year, lat, lng, score in EXAMPLES:
        exists = db.query(database.Asset).filter_by(workspace_id=workspace.id, name=name).first()
        if not exists:
            db.add(
                database.Asset(
                    workspace_id=workspace.id,
                    name=name,
                    asset_type=kind,
                    construction_year=year,
                    latitude=lat,
                    longitude=lng,
                    condition_score=score,
                )
            )
            added += 1
    return added
