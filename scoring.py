from datetime import datetime
from typing import Optional, Tuple


def maintenance_priority(health_score: float) -> str:
    """Translate a health score into the prototype's priority bands."""
    if health_score < 40:
        return "Emergency"
    if health_score < 70:
        return "High"
    return "Low"


def calculate_health(
    asset_type: str,
    construction_year: int,
    *,
    current_year: Optional[int] = None,
) -> Tuple[int, float, str]:
    """Calculate age, health score, and priority for a new asset."""
    year = current_year or datetime.now().year
    if construction_year <= 0 or construction_year > year:
        raise ValueError("construction_year must be a valid year in the past")

    age = year - construction_year
    decay_rate = 3.0 if asset_type.casefold() == "road" else 0.5
    health_score = max(0.0, 100.0 - age * decay_rate)
    return age, health_score, maintenance_priority(health_score)
