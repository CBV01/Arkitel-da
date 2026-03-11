import os
import sys
from dotenv import load_dotenv # type: ignore

# Add current folder to sys.path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

load_dotenv(os.path.join('backend', '.env'))

from database import get_db_connection # type: ignore

def check():
    url = os.getenv('TURSO_DATABASE_URL')
    if url:
        truncated_url = ""
        for i, char in enumerate(url):
            if i >= 30: break
            truncated_url += char
        print(f"URL: {truncated_url}...")
    else:
        print("URL: None")
    conn = get_db_connection()
    try:
        # Get users
        print("\n--- USERS ---")
        users = conn.execute("SELECT id, username, role FROM users").fetchall()
        for u in users:
            print(f"ID: {u[0]} | User: {u[1]} | Role: {u[2]}")
        
        # Get accounts
        print("\n--- ACCOUNTS ---")
        accounts = conn.execute("SELECT phone_number, user_id, status FROM accounts").fetchall()
        for a in accounts:
            print(f"Phone: {a[0]} | UID: {a[1]} | Status: {a[2]}")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if hasattr(conn, "close"): conn.close()

if __name__ == "__main__":
    check()
