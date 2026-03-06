import os
from dotenv import load_dotenv
from database import get_db_connection

load_dotenv()

def migrate():
    conn = get_db_connection()
    
    print("Starting migration...")
    
    # List of alter table commands to ensure columns exist
    # SQLite/LibSQL doesn't have "IF NOT EXISTS" for ADD COLUMN, so we try/except
    alter_queries = [
        ("users", "role", "TEXT DEFAULT 'user'"),
        ("users", "is_active", "INTEGER DEFAULT 1"),
        ("users", "passkey_verified", "INTEGER DEFAULT 0"),
        ("tasks", "interval_hours", "INTEGER DEFAULT 0"),
        ("tasks", "scheduled_time", "TEXT DEFAULT ''"), # In case it was missing
    ]
    
    for table, column, definition in alter_queries:
        try:
            print(f"Adding column {column} to {table}...")
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            print(f"Success: Added {column} to {table}")
        except Exception as e:
            # Most likely column already exists
            print(f"Skipped: {column} in {table} (Error: {str(e)})")
            
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    print("Migration finished.")

if __name__ == "__main__":
    migrate()
