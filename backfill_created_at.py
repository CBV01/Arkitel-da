import os
import sys
from dotenv import load_dotenv # type: ignore

load_dotenv("backend/.env")
sys.path.append(os.path.join(os.getcwd(), 'backend'))
from database import get_db_connection # type: ignore

conn = get_db_connection()
try:
    conn.execute("UPDATE accounts SET created_at = datetime('now') WHERE created_at IS NULL")
    print("Updated existing accounts with created_at value.")
except Exception as e:
    print("Error:", e)
