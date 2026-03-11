import os
import sys
import sqlite3
import json
from dotenv import load_dotenv

def check_db(name, url, token=None):
    print(f"\n=== Checking {name} ===")
    print(f"URL: {url}")
    
    if url.startswith("libsql://") or url.startswith("https://"):
        from backend.database import TursoConnection
        conn = TursoConnection(url, token)
    else:
        conn = sqlite3.connect(url)
        conn.row_factory = sqlite3.Row
        
    try:
        # Check users
        users = conn.execute("SELECT id, username, role FROM users").fetchall()
        print(f"Users found: {len(users)}")
        for u in users:
            print(f"  - ID: {u[0]} | Name: {u[1]} | Role: {u[2]}")
            
        # Check accounts
        accounts = conn.execute("SELECT phone_number, user_id, status FROM accounts").fetchall()
        print(f"Accounts found: {len(accounts)}")
        for a in accounts:
            print(f"  - Phone: {a[0]} | UID: {a[1]} | Status: {a[2]}")
            
    except Exception as e:
        print(f"  Error: {e}")
    finally:
        if hasattr(conn, "close"): conn.close()

if __name__ == "__main__":
    # 1. Check Root Local
    if os.path.exists("telegram_app.db"):
        check_db("Root Local DB", "telegram_app.db")
    
    # 2. Check Backend Local
    if os.path.exists("backend/telegram_app.db"):
        check_db("Backend Local DB", "backend/telegram_app.db")
        
    # 3. Check Turso from backend/.env
    if os.path.exists("backend/.env"):
        print("\nLoading backend/.env...")
        load_dotenv("backend/.env")
        url = os.getenv("TURSO_DATABASE_URL")
        token = os.getenv("TURSO_AUTH_TOKEN")
        if url:
            check_db("Turso (from backend/.env)", url, token)
        else:
            print("No TURSO_DATABASE_URL in backend/.env")
    else:
        print("backend/.env not found")
