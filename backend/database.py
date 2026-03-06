"""
database.py - Turso HTTP API client for the Telegram Automation Platform.

Uses Turso's standard HTTP API directly via `requests` for maximum compatibility.
Falls back to local SQLite if TURSO_DATABASE_URL is not set.
"""

import os
import sqlite3
import requests
from typing import Any, List, Optional


# ---------------------------------------------------------------------------
# Turso HTTP Client wrapper
# ---------------------------------------------------------------------------

class TursoRow:
    """Mimics sqlite3.Row for Turso results so app code stays the same."""
    def __init__(self, columns: List[str], values: List[Any]):
        self._data = dict(zip(columns, values))
        self._values = values

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return self._data[key]

    def __iter__(self):
        return iter(self._values)

    def keys(self):
        return list(self._data.keys())


class TursoCursor:
    def __init__(self, columns: List[str], rows: List[List[Any]]):
        self._columns = columns
        self._rows = [TursoRow(columns, r) for r in rows]

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


class TursoConnection:
    """Thin wrapper around the Turso HTTP API (pipeline endpoint)."""

    def __init__(self, db_url: str, auth_token: str):
        # Convert libsql:// URL → https://
        if db_url.startswith("libsql://"):
            db_url = db_url.replace("libsql://", "https://", 1)
        self._url = db_url.rstrip("/") + "/v2/pipeline"
        self._headers = {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
        }

    def execute(self, sql: str, params: tuple = ()) -> TursoCursor:
        """Execute a single SQL statement and return a cursor-like object."""
        payload = {
            "requests": [
                {
                    "type": "execute",
                    "stmt": {
                        "sql": sql,
                        "args": [{"type": "text", "value": str(p)} if p is not None else {"type": "null"} for p in params],
                    }
                },
                {"type": "close"}
            ]
        }
        resp = requests.post(self._url, json=payload, headers=self._headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        result = data["results"][0]
        if result.get("type") == "error":
            raise Exception(result["error"]["message"])

        resp_data = result.get("response", {})
        result_set = resp_data.get("result", {})
        cols = [c["name"] for c in result_set.get("cols", [])]
        rows = [[cell.get("value") for cell in row] for row in result_set.get("rows", [])]
        return TursoCursor(cols, rows)

    def commit(self):
        pass  # Turso auto-commits

    def close(self):
        pass  # HTTP connections are stateless


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def get_db_connection():
    db_url = os.getenv("TURSO_DATABASE_URL", "")
    auth_token = os.getenv("TURSO_AUTH_TOKEN", "")

    if db_url and (db_url.startswith("libsql://") or db_url.startswith("https://")):
        return TursoConnection(db_url, auth_token)

    # Local SQLite fallback
    local_path = db_url.replace("file:", "") if db_url else "./telegram_app.db"
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
            status TEXT DEFAULT 'active'
        )""",
        """CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            phone_number TEXT,
            scheduled_time TEXT NOT NULL,
            message_text TEXT NOT NULL,
            target_groups TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            interval_hours INTEGER DEFAULT 0
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
        """CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )""",
    ]

    conn = get_db_connection()
    for q in table_queries:
        conn.execute(q)
    
    # Seed default settings
    conn.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('admin_password', 'admin123')")
    conn.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('global_passkey', '123456')")
    
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    print("Database initialized successfully.")


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    init_db()
