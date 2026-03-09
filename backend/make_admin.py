
import os
import sqlite3
import json
import urllib.request
import urllib.error
import ssl

def get_env():
    env = {}
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    env[k] = v
    elif os.path.exists("../.env"):
        # check parent if in backend dir
        with open("../.env", "r") as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    env[k] = v
    return env

def make_admin():
    env = get_env()
    db_url = env.get("TURSO_DATABASE_URL", "")
    auth_token = env.get("TURSO_AUTH_TOKEN", "")
    
    sql = "UPDATE users SET role = 'admin'"
    
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
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            with urllib.request.urlopen(req, context=ctx) as response:
                resp_data = json.loads(response.read().decode('utf-8'))
                if resp_data["results"][0].get("type") == "error":
                    print(f"Turso Error: {resp_data['results'][0]['error']['message']}")
                else:
                    print("Turso: All users are now admins.")
        except Exception as e:
            print(f"Turso update failed: {e}")
    else:
        print("DEBUG: Connecting to Local SQLite")
        try:
            conn = sqlite3.connect("./telegram_app.db")
            conn.execute(sql)
            conn.commit()
            conn.close()
            print("Local: All users are now admins.")
        except Exception as e:
            print(f"Local update failed: {e}")

if __name__ == "__main__":
    make_admin()
