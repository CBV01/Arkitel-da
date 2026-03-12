"""
database.py - Turso HTTP API client for the Telegram Automation Platform.

Uses Turso's standard HTTP API directly via `requests` for maximum compatibility.
Falls back to local SQLite if TURSO_DATABASE_URL is not set.
"""

import os
import sqlite3
import json
import urllib.request
import urllib.parse
import urllib.error
from typing import Any, List, Optional, Dict, Union, cast
from dotenv import load_dotenv  # type: ignore
load_dotenv()


# ---------------------------------------------------------------------------
# Turso HTTP Client wrapper
# ---------------------------------------------------------------------------

class TursoRow:
    """Mimics sqlite3.Row for Turso results so app code stays the same."""
    def __init__(self, columns: List[str], values: List[Any]):
        self._columns = columns
        self._values = values
        self._data = dict(zip(columns, values))

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return self._data[key]

    def __iter__(self):
        return iter(self._values)

    def keys(self):
        return self._columns


class TursoCursor:
    def __init__(self, columns: List[str], rows: List[List[Any]]):
        self._columns = columns
        self._rows = [TursoRow(columns, r) for r in rows]

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


class TursoConnection:
    """Thin wrapper around the Turso HTTP API (pipeline endpoint) using standard urllib."""

    def __init__(self, db_url: str, auth_token: str):
        if db_url.startswith("libsql://"):
            db_url = db_url.replace("libsql://", "https://", 1)
        self._url = db_url.rstrip("/") + "/v2/pipeline"
        self._headers = {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
        }

    def execute(self, sql: str, params: tuple = ()) -> TursoCursor:
        # Build args list for Turso
        args = []
        for p in params:
            if p is None:
                args.append({"type": "null", "value": "null"})
            elif isinstance(p, bool):
                # SQLite usually treats bool as integer 0/1, but let's be explicit
                args.append({"type": "integer", "value": "1" if p else "0"})
            elif isinstance(p, int):
                args.append({"type": "integer", "value": str(p)})
            elif isinstance(p, float):
                args.append({"type": "float", "value": str(p)})
            else:
                args.append({"type": "text", "value": str(p)})

        payload = {
            "requests": [
                {
                    "type": "execute",
                    "stmt": {
                        "sql": sql,
                        "args": args,
                    }
                },
                {"type": "close"}
            ]
        }
        
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(self._url, data=data, headers=self._headers, method='POST')
        
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                resp_body = response.read().decode('utf-8')
                resp_json = json.loads(resp_body)
                
                # Turso v2 pipeline response structure:
                # { "results": [ { "type": "ok", "response": { "result": { "cols": [...], "rows": [...] } } }, ... ] }
                
                results = resp_json.get("results", [])
                if not results:
                    return TursoCursor([], [])

                # The first result corresponds to our 'execute' statement
                exec_res = results[0]
                
                if exec_res.get("type") == "error":
                    raise Exception(exec_res.get("error", {}).get("message", "Unknown Turso Error"))

                # Extract 'result' object from inside 'response'
                inner_res = exec_res.get("response", {}).get("result", {})
                
                # Columns
                cols = [c["name"] for c in inner_res.get("cols", [])]
                
                # Rows
                # Turso returns rows as arrays of { "type": "...", "value": "..." }
                # We need to extract the raw values.
                final_rows = []
                raw_rows = inner_res.get("rows", [])
                
                for r in raw_rows:
                    # r is a list of cells
                    row_vals = []
                    for cell in r:
                        # cell is {"type": "text", "value": "foo"}
                        # or {"type": "null", "value": None}
                        # or {"type": "integer", "value": "123"}
                        val = cell.get("value")
                        if cell.get("type") == "integer" and val is not None:
                            val = int(val)
                        elif cell.get("type") == "float" and val is not None:
                            val = float(val)
                        row_vals.append(val)
                    final_rows.append(row_vals)
                        
                return TursoCursor(cols, final_rows)

        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8')
            print(f"Turso HTTP Error {e.code}: {err_body}")
            raise Exception(f"Turso API Error: {err_body}")
        except Exception as e:
            print(f"Turso Connection Error: {str(e)}")
            raise

    def commit(self):
        pass

    def close(self):
        pass


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def get_db_connection() -> Any:
    db_url = os.getenv("TURSO_DATABASE_URL", "")
    auth_token = os.getenv("TURSO_AUTH_TOKEN", "")

    if db_url and (db_url.startswith("libsql://") or db_url.startswith("https://")):
        # print("DB: Using Turso Cloud")
        return TursoConnection(db_url, auth_token)

    # Local SQLite fallback
    local_path = db_url.replace("file:", "") if db_url else "./telegram_app.db"
    # print(f"DB: Using local SQLite ({local_path})")
    conn = sqlite3.connect(local_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create all tables and seed default settings."""
    table_queries = [
        """CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            is_active INTEGER DEFAULT 1,
            passkey_verified INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            session_string TEXT NOT NULL,
            api_id TEXT,
            api_hash TEXT,
            first_name TEXT,
            last_name TEXT,
            username TEXT,
            profile_photo TEXT,
            country TEXT,
            status TEXT DEFAULT 'active',
            status_detail TEXT,
            last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            name TEXT,
            phone_number TEXT,
            scheduled_time TEXT NOT NULL,
            message_text TEXT NOT NULL,
            target_groups TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            interval_hours INTEGER DEFAULT 0,
            total_targets INTEGER DEFAULT 0,
            sent_count INTEGER DEFAULT 0,
            batch_number INTEGER DEFAULT 1,
            failed_groups TEXT DEFAULT '[]'
        )""",
        """CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            group_id TEXT,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS scrape_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS scraped_groups (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT,
            username TEXT,
            participants_count INTEGER DEFAULT 0,
            type TEXT,
            is_private INTEGER DEFAULT 0,
            country TEXT,
            user_shows INTEGER DEFAULT 1,
            global_shows INTEGER DEFAULT 1,
            source TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS broadcasts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'info',
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS lead_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            group_id TEXT,
            tg_id TEXT,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            phone TEXT,
            country TEXT,
            scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS account_joins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            group_id TEXT NOT NULL,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(phone_number, group_id)
        )""",
    ]

    conn = cast(Any, get_db_connection())
    for q in table_queries:
        conn.execute(q)
    
    # Migration: Ensure accounts table has all needed fields
    needed_cols = [
        ("user_id", "TEXT"),
        ("first_name", "TEXT"),
        ("last_name", "TEXT"),
        ("username", "TEXT"),
        ("profile_photo", "TEXT"),
        ("country", "TEXT"),
        ("created_at", "DATETIME")
    ]
    for col_name, col_type in needed_cols:
        try:
            conn.execute(f"ALTER TABLE accounts ADD COLUMN {col_name} {col_type}")
        except:
            pass # Column likely exists

    # Migration for leads table
    try:
        conn.execute("ALTER TABLE leads ADD COLUMN type TEXT DEFAULT 'group'")
        conn.execute("ALTER TABLE leads ADD COLUMN source TEXT DEFAULT 'scraper'")
    except:
        pass
    
    # Seed default settings
    conn.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('admin_password', 'admin123')")
    conn.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('global_passkey', '123456')")
    
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    print("Database initialized successfully.")


if __name__ == "__main__":
    init_db()
