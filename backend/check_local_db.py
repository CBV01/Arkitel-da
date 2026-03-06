import sqlite3
import os

db_path = "./telegram_app.db"
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT username, role, passkey_verified FROM users").fetchall()
    print(f"--- Local DB: {db_path} ---")
    for row in rows:
        print(f"  username={row['username']}, role={row['role']}, verified={row['passkey_verified']}")
else:
    print(f"Local DB {db_path} does not exist.")
