import os

# Base persistence
DATABASE_URL = os.getenv("TURSO_DATABASE_URL", "sqlite:///./app_persistent.db")
CORE_PROVIDER_ID = os.getenv("CORE_PROVIDER_ID", "")
CORE_PROVIDER_KEY = os.getenv("CORE_PROVIDER_KEY", "")
