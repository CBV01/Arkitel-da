"""Run this script ONCE to create all tables in Turso and set up the admin user."""

import os
import sys
import uuid

# ── Set credentials directly ──────────────────────────────────────────────────
os.environ["TURSO_DATABASE_URL"] = "libsql://arkitel-arkitel.aws-ap-northeast-1.turso.io"
os.environ["TURSO_AUTH_TOKEN"] = (
    "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzI0MTk0NDEsImlkIjoiMDE5Y2FjNmUtM2UwMS03Nzg1LWFiNWMtZmFhZGM4YmVkZTc0IiwicmlkIjoiYzRjM2U1ODMtYjUxMC00NjliLTkwNDktY2NiOTAxNDFmODZmIn0"
    ".StoC_bGVTicy-0WbtSrZAfW3qOD1nG1GJhQhut1-MKo3PKlyAQ6AHQsYuOHYg1lt1h98VZj4VXhSmKc87Fo4Ag"
)
os.environ["JWT_SECRET"] = "super-secret-key-change-this-in-production"

from database import get_db_connection, init_db
from auth import get_password_hash

def main():
    print("=== Telegram Platform – Turso Setup ===\n")

    # 1. Create all tables
    print("[1/3] Creating tables...")
    init_db()

    conn = get_db_connection()

    # 2. Create admin user
    print("[2/3] Setting up admin user...")
    admin_username = "admin"
    admin_password = "adminpassword123"   # ← Change after first login!

    existing = conn.execute(
        "SELECT id FROM users WHERE username = ?", (admin_username,)
    ).fetchone()

    if not existing:
        admin_id = str(uuid.uuid4())
        pw_hash = get_password_hash(admin_password)
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, passkey_verified) VALUES (?, ?, ?, ?, ?)",
            (admin_id, admin_username, pw_hash, "admin", 1)
        )
        print(f"   [OK] Admin user created  -> username: {admin_username} | password: {admin_password}")
    else:
        print("   [INFO] Admin user already exists, skipping.")

    # 3. Set global passkey
    print("[3/3] Setting global passkey...")
    global_passkey = "123456"   # Tell your users this value

    existing_passkey = conn.execute(
        "SELECT value FROM system_settings WHERE key = 'global_passkey'"
    ).fetchone()

    if not existing_passkey:
        conn.execute(
            "INSERT INTO system_settings (key, value) VALUES (?, ?)",
            ("global_passkey", global_passkey)
        )
        print(f"   [OK] Global passkey set -> {global_passkey}")
    else:
        print(f"   [INFO] Global passkey already set: {existing_passkey[0]}")

    print("\n=== Setup complete! ===")
    print(f"  Login at /login with  admin / {admin_password}")
    print(f"  Tell users the passkey: {global_passkey}")

if __name__ == "__main__":
    main()
