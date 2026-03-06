"""Quick test to verify Turso connection is working."""
import os
os.environ["TURSO_DATABASE_URL"] = "libsql://arkitel-arkitel.aws-ap-northeast-1.turso.io"
os.environ["TURSO_AUTH_TOKEN"] = (
    "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzI0MTk0NDEsImlkIjoiMDE5Y2FjNmUtM2UwMS03Nzg1LWFiNWMtZmFhZGM4YmVkZTc0IiwicmlkIjoiYzRjM2U1ODMtYjUxMC00NjliLTkwNDktY2NiOTAxNDFmODZmIn0"
    ".StoC_bGVTicy-0WbtSrZAfW3qOD1nG1GJhQhut1-MKo3PKlyAQ6AHQsYuOHYg1lt1h98VZj4VXhSmKc87Fo4Ag"
)

from database import get_db_connection

conn = get_db_connection()

print("--- Users ---")
rows = conn.execute("SELECT username, role FROM users").fetchall()
for row in rows:
    print(f"  username={row[0]}  role={row[1]}")

print("\n--- System Settings ---")
rows2 = conn.execute("SELECT key, value FROM system_settings").fetchall()
for row in rows2:
    print(f"  {row[0]} = {row[1]}")

print("\n--- Tables (via pragma workaround: SELECT) ---")
for tbl in ["users", "accounts", "tasks", "leads", "system_settings"]:
    try:
        conn.execute(f"SELECT COUNT(*) FROM {tbl}")
        print(f"  [OK] Table '{tbl}' exists")
    except Exception as e:
        print(f"  [MISSING] {tbl}: {e}")

print("\nConnection OK")
