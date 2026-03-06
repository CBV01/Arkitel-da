import os

# SQLite path or LibSQL (Turso) connection string
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./telegram_app.db")
TELEGRAM_API_ID = os.getenv("TELEGRAM_API_ID", "")
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH", "")
