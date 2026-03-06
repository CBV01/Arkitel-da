import os
import requests
import json

url = "libsql://arkitel-arkitel.aws-ap-northeast-1.turso.io"
token = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzI0MTk0NDEsImlkIjoiMDE5Y2FjNmUtM2UwMS03Nzg1LWFiNWMtZmFhZGM4YmVkZTc0IiwicmlkIjoiYzRjM2U1ODMtYjUxMC00NjliLTkwNDktY2NiOTAxNDFmODZmIn0.StoC_bGVTicy-0WbtSrZAfW3qOD1nG1GJhQhut1-MKo3PKlyAQ6AHQsYuOHYg1lt1h98VZj4VXhSmKc87Fo4Ag"

# Convert libsql:// URL → https://
if url.startswith("libsql://"):
    url = url.replace("libsql://", "https://", 1)
v2_url = url.rstrip("/") + "/v2/pipeline"

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
}

def execute(sql):
    payload = {
        "requests": [
            {
                "type": "execute",
                "stmt": {"sql": sql}
            },
            {"type": "close"}
        ]
    }
    resp = requests.post(v2_url, json=payload, headers=headers)
    return resp.json()

# 1. Update
print("Updating all users...")
update_res = execute("UPDATE users SET role = 'admin', passkey_verified = 1")
print(f"Update result: {json.dumps(update_res, indent=2)}")

# 2. List
print("\nListing all users...")
list_res = execute("SELECT id, username, role, passkey_verified FROM users")
print(f"List result: {json.dumps(list_res, indent=2)}")
