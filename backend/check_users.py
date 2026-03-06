import os
import requests
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv("TURSO_DATABASE_URL", "")
auth_token = os.getenv("TURSO_AUTH_TOKEN", "")

print(f"URL: {db_url}")

if not db_url.startswith("https://"):
    db_url = db_url.replace("libsql://", "https://")

url = db_url.rstrip("/") + "/v2/pipeline"
headers = {
    "Authorization": f"Bearer {auth_token}",
    "Content-Type": "application/json",
}

payload = {
    "requests": [
        {
            "type": "execute",
            "stmt": {
                "sql": "SELECT username, role, passkey_verified FROM users",
                "args": []
            }
        },
        {"type": "close"}
    ]
}

resp = requests.post(url, json=payload, headers=headers)
data = resp.json()

if "results" in data:
    result = data["results"][0]
    if "response" in result:
        res_set = result["response"]["result"]
        cols = [c["name"] for c in res_set["cols"]]
        rows = res_set["rows"]
        
        print("\n--- Users in Turso ---")
        for row in rows:
            user_data = [cell["value"] for cell in row]
            print(dict(zip(cols, user_data)))
    else:
        print("Error in response:", result.get("error"))
else:
    print("No results found.")
