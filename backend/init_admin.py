import os
import uuid
import sys
from database import get_db_connection
from auth import get_password_hash

def init_admin():
    admin_username = "admin"
    admin_password = "adminpassword123" # User should change this
    global_passkey = "123456" # User should provide this to others
    
    conn = get_db_connection()
    
    # Init Admin
    user_check = conn.execute("SELECT id FROM users WHERE role = 'admin'").fetchone()
    if not user_check:
        admin_id = str(uuid.uuid4())
        pw_hash = get_password_hash(admin_password)
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, passkey_verified) VALUES (?, ?, ?, ?, ?)",
            (admin_id, admin_username, pw_hash, "admin", 1)
        )
        print(f"Admin user created: {admin_username}")
    else:
        print("Admin user already exists.")
        
    # Init Passkey
    passkey_check = conn.execute("SELECT value FROM system_settings WHERE key = 'global_passkey'").fetchone()
    if not passkey_check:
        conn.execute("INSERT INTO system_settings (key, value) VALUES (?, ?)", ("global_passkey", global_passkey))
        print(f"Global passkey set: {global_passkey}")
    else:
        print("Global passkey already exists.")
        
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    print("Administrative setup complete.")

if __name__ == "__main__":
    init_admin()
