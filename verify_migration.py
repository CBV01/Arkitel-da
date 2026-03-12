import os
import sys
from dotenv import load_dotenv
sys.path.append(os.path.join(os.getcwd(), 'backend'))
load_dotenv(os.path.join('backend', '.env'))
from database import get_db_connection

def verify_migration():
    conn = get_db_connection()
    try:
        print("\n--- Verifying Users Columns ---")
        res = conn.execute("PRAGMA table_info(users)").fetchall()
        cols = [r[1] for r in res]
        print(f"Columns: {cols}")
        
        needed = ["plan", "scrape_limit", "max_accounts", "is_approved"]
        for n in needed:
            if n in cols:
                print(f"✅ {n} exists")
            else:
                print(f"❌ {n} MISSING")

        print("\n--- Verifying Coupons Table ---")
        try:
            conn.execute("SELECT 1 FROM coupons LIMIT 0")
            print("✅ coupons table exists")
        except:
            print("❌ coupons table MISSING")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        if hasattr(conn, "close"): conn.close()

if __name__ == "__main__":
    verify_migration()
