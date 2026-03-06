import os
from database import get_db_connection

os.environ["TURSO_DATABASE_URL"] = "libsql://arkitel-arkitel.aws-ap-northeast-1.turso.io"
os.environ["TURSO_AUTH_TOKEN"] = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzI0MTk0NDEsImlkIjoiMDE5Y2FjNmUtM2UwMS03Nzg1LWFiNWMtZmFhZGM4YmVkZTc0IiwicmlkIjoiYzRjM2U1ODMtYjUxMC00NjliLTkwNDktY2NiOTAxNDFmODZmIn0.StoC_bGVTicy-0WbtSrZAfW3qOD1nG1GJhQhut1-MKo3PKlyAQ6AHQsYuOHYg1lt1h98VZj4VXhSmKc87Fo4Ag"

conn = get_db_connection()
conn.execute("UPDATE users SET role = 'admin', passkey_verified = 1 WHERE username = 'admin'")
if hasattr(conn, "commit"): conn.commit()
print("User 'admin' promoted and verified.")
