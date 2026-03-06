import os
from database import get_db_connection

os.environ["TURSO_DATABASE_URL"] = "libsql://arkitel-arkitel.aws-ap-northeast-1.turso.io"
os.environ["TURSO_AUTH_TOKEN"] = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzI0MTk0NDEsImlkIjoiMDE5Y2FjNmUtM2UwMS03Nzg1LWFiNWMtZmFhZGM4YmVkZTc0IiwicmlkIjoiYzRjM2U1ODMtYjUxMC00NjliLTkwNDktY2NiOTAxNDFmODZmIn0.StoC_bGVTicy-0WbtSrZAfW3qOD1nG1GJhQhut1-MKo3PKlyAQ6AHQsYuOHYg1lt1h98VZj4VXhSmKc87Fo4Ag"

conn = get_db_connection()
rows = conn.execute("SELECT username, role, passkey_verified FROM users").fetchall()
for row in rows:
    print(f"DEBUG_USER: username={row[0]}, role={row[1]}, verified={row[2]}")
