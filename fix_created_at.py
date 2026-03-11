import os
import sys
from dotenv import load_dotenv

load_dotenv("backend/.env")
sys.path.append(os.path.join(os.getcwd(), 'backend'))
from backend.database import get_db_connection

conn = get_db_connection()
try:
    conn.execute("ALTER TABLE accounts ADD COLUMN created_at DATETIME")
    print("Added created_at without DEFAULT.")
except Exception as e:
    print("Error without DEFAULT:", e)

try:
    cols = conn.execute("PRAGMA table_info(accounts)").fetchall()
    print("Accounts columns:", [c['name'] if isinstance(c, dict) else c[1] for c in cols])
except Exception as e:
    print("Error listing columns:", e)
