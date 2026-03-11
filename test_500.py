import os
import sys
from dotenv import load_dotenv # type: ignore

load_dotenv("backend/.env")

def test_accounts():
    sys.path.append(os.path.join(os.getcwd(), 'backend'))
    from database import get_db_connection # type: ignore
    conn = get_db_connection()
    try:
        rows = conn.execute("""
            SELECT phone_number, status, api_id, api_hash, 
                   first_name, last_name, username, profile_photo, country, created_at 
            FROM accounts
        """).fetchall()
        print("Success! Got rows:", len(rows))
        for r in rows:
            print(r)
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_accounts()
