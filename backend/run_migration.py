
import urllib.request
import urllib.error
import urllib.parse
import json
import os
import sqlite3
import ssl

def get_env():
    env = {}
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    env[k] = v
    return env

def run_migration():
    env = get_env()
    db_url = env.get("TURSO_DATABASE_URL", "")
    auth_token = env.get("TURSO_AUTH_TOKEN", "")
    
    sql = "ALTER TABLE tasks ADD COLUMN name TEXT;"
    
    if db_url and (db_url.startswith("libsql://") or db_url.startswith("https://")):
        print(f"DEBUG: Connecting to Turso: {db_url}")
        if db_url.startswith("libsql://"):
            db_url = db_url.replace("libsql://", "https://", 1)
        url = db_url.rstrip("/") + "/v2/pipeline"
        
        headers = {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "requests": [
                {
                    "type": "execute",
                    "stmt": { "sql": sql }
                },
                {"type": "close"}
            ]
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers=headers)
        
        try:
            # Bypass SSL verification if any issues
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            with urllib.request.urlopen(req, context=ctx) as response:
                resp_data = json.loads(response.read().decode('utf-8'))
                if resp_data["results"][0].get("type") == "error":
                    print(f"Turso Error (likely column exists): {resp_data['results'][0]['error']['message']}")
                else:
                    print("Turso Migration: Added 'name' column to 'tasks' table.")
        except urllib.error.HTTPError as e:
            print(f"Turso Connection Failed: {e.code} {e.read().decode('utf-8')}")
        except Exception as e:
            print(f"Error: {e}")
    else:
        print("DEBUG: Connecting to Local SQLite")
        try:
            conn = sqlite3.connect("./telegram_app.db")
            conn.execute(sql)
            conn.commit()
            conn.close()
            print("Local Migration: Added 'name' column to 'tasks' table.")
        except Exception as e:
            print(f"Local Migration Error (likely exists): {e}")

if __name__ == "__main__":
    run_migration()
