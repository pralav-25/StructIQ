from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# 1. Setup the Database File
SQLALCHEMY_DATABASE_URL = "sqlite:///./structiq.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# 2. Define the Asset Table
class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    asset_type = Column(String)
    age = Column(Integer)
    construction_year = Column(Integer)
    latitude = Column(Float)
    longitude = Column(Float)
    health_score = Column(Float, default=100.0) # Changed to Float for precision math
    # PPT Features
    vibration_level = Column(Float, default=0.05)
    last_service_date = Column(String, default="2023-10-10")
    maintenance_priority = Column(String, default="Low")

# 3. Define the Report Table
class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer)
    description = Column(String)
    severity = Column(Integer)
    status = Column(String, default="Open")