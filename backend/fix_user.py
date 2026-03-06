import os
import dotenv
from database import get_db_connection

def fix_user():
    dotenv.load_dotenv()
    conn = get_db_connection()
    try:
        # Check if webyzoid exists
        row = conn.execute("SELECT id FROM users WHERE username = 'webyzoid'").fetchone()
        if row:
            print("Found user 'webyzoid', updating to 'webyzoid@gmail.com' and setting role to 'user'")
            conn.execute("UPDATE users SET username = 'webyzoid@gmail.com', role = 'user' WHERE username = 'webyzoid'")
            conn.commit()
        else:
            print("User 'webyzoid' not found. Checking if 'webyzoid@gmail.com' already exists...")
            row2 = conn.execute("SELECT id FROM users WHERE username = 'webyzoid@gmail.com'").fetchone()
            if row2:
                print("User 'webyzoid@gmail.com' exists. Ensuring role is 'user'")
                conn.execute("UPDATE users SET role = 'user' WHERE username = 'webyzoid@gmail.com'")
                conn.commit()
            else:
                print("No user found with either name.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if hasattr(conn, "close"): conn.close()

if __name__ == "__main__":
    fix_user()
