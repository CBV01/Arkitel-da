import os
from dotenv import load_dotenv  # type: ignore
load_dotenv()  # Load .env file before anything else

from fastapi import FastAPI, HTTPException, Depends, status  # type: ignore
from pydantic import BaseModel  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from database import get_db_connection  # type: ignore
import uuid
from datetime import datetime, timedelta, timezone
import collections
import asyncio
import random
from typing import Optional, List, Dict, Any
import re
import ast
import traceback
from contextlib import asynccontextmanager

# Telethon Imports
from telethon.sync import TelegramClient  # type: ignore
from telethon.sessions import StringSession  # type: ignore
from telethon.tl.functions.channels import JoinChannelRequest, GetParticipantsRequest  # type: ignore
from telethon.tl.types import ChannelParticipantsSearch  # type: ignore

from config import TELEGRAM_API_ID, TELEGRAM_API_HASH  # type: ignore
from auth import get_password_hash, verify_password, create_access_token, get_current_user_id  # type: ignore
import uvicorn  # type: ignore

# Simple in-memory log buffer
LOG_BUFFER = collections.deque(maxlen=100)

def log_debug(msg: str):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {msg}"
    print(formatted)
    LOG_BUFFER.append(formatted)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    print("CORE: Initializing Database Schema...")
    try:
        from database import init_db # type: ignore
        init_db()
        print("CORE: Database Schema Initialized.")
    except Exception as e:
        print(f"CORE: Database Initialization ERROR: {e}")

    print("CORE: Starting Task Automation Poller...")
    poller_task = asyncio.create_task(task_poller())
    print("CORE: System Ready and Poller Started.")
    
    yield
    
    # Shutdown logic
    print("CORE: Shutting down...")
    poller_task.cancel()
    try:
        await poller_task
    except asyncio.CancelledError:
        print("CORE: Poller task cancelled.")

app = FastAPI(title="Telegram Automation API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, set this to process.env.FRONTEND_URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/debug/db")
async def debug_db():
    url = os.getenv("TURSO_DATABASE_URL", "NOT_SET")
    token = os.getenv("TURSO_AUTH_TOKEN", "NOT_SET")
    u_str = str(url) if url else "NOT_SET"
    display_url = str(u_str)[0:20] + "..." if u_str != "NOT_SET" else "NOT_SET" # type: ignore
    return {
        "url": display_url,
        "token_set": bool(token and token != "NOT_SET"),
        "env_file_exists": os.path.exists(".env")
    }

from fastapi import Request  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore
import traceback

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"GLOBAL_ERROR: {str(exc)}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "error": str(exc), "traceback": traceback.format_exc()},
    )

@app.get("/health")
async def health():
    # Use UTC for absolute consistency across platforms
    now_utc = datetime.now(timezone.utc)
    return {
        "status": "healthy", 
        "server_time_utc": now_utc.isoformat(),
        "poller_format_utc": now_utc.strftime('%Y-%m-%dT%H:%M'),
        "note": "All campaigns are processed in UTC time to match browser standards."
    }

# Temporary in-memory store for login sessions
# phone -> { "client": TelegramClient, "phone_code_hash": str, "api_id": str, "api_hash": str }
auth_sessions: Dict[str, Dict[str, Any]] = {}

class UserRegister(BaseModel):
    username: str
    password: str

class PasskeyVerify(BaseModel):
    passkey: str

class PhoneLoginRequest(BaseModel):
    phone_number: str
    api_id: str
    api_hash: str

class VerifyCodeRequest(BaseModel):
    phone_number: str
    phone_code_hash: str
    code: str

class CampaignRequest(BaseModel):
    name: str
    phone_number: str
    schedule_time: str
    message: str
    groups: list[str] = []
    interval_hours: int = 0

class AdminLoginRequest(BaseModel):
    password: str

# --- Authentication Endpoints ---

@app.post("/api/auth/register")
async def register(user: UserRegister):
    conn = get_db_connection()
    # Check if user exists
    user_check = conn.execute("SELECT id FROM users WHERE username = ?", (user.username,)).fetchone()
    if user_check:
        if hasattr(conn, "close"): conn.close()
        raise HTTPException(status_code=400, detail="Username already taken")
    
    user_id = str(uuid.uuid4())
    pw_hash = get_password_hash(user.password)
    
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
        (user_id, user.username, pw_hash, "user")
    )
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success", "message": "Registered successfully"}

@app.post("/api/auth/login")
async def login(user: UserRegister):
    conn = get_db_connection()
    db_user = conn.execute("SELECT id, password_hash, role FROM users WHERE username = ?", (user.username,)).fetchone()
    if hasattr(conn, "close"): conn.close()
    
    if not db_user or not verify_password(user.password, db_user[1]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    access_token = create_access_token(data={"sub": db_user[0], "role": db_user[2]})
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/api/auth/admin-login")
async def admin_login(req: AdminLoginRequest):
    conn = get_db_connection()
    # Check if a passkey exists in settings. Use 'admin_password' or fallback to 'global_passkey'
    row = conn.execute("SELECT value FROM system_settings WHERE key = 'admin_password'").fetchone()
    if not row:
        row = conn.execute("SELECT value FROM system_settings WHERE key = 'global_passkey'").fetchone()
    
    if hasattr(conn, "close"): conn.close()
    
    # Default admin password if none ever set
    admin_pw = row[0] if row else "admin123" 
    
    if req.password != admin_pw:
        raise HTTPException(status_code=401, detail="Invalid administrative password")
    
    access_token = create_access_token(data={"sub": "admin_virtual_id", "role": "admin"})
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/api/auth/verify-passkey")
async def verify_passkey(req: PasskeyVerify, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    # Fetch global passkey
    stored_passkey = conn.execute("SELECT value FROM system_settings WHERE key = 'global_passkey'").fetchone()
    if not stored_passkey:
        # Default passkey if none set (e.g., initial setup)
        # You should probably set this during init_db or admin setup
        stored_passkey = ["123456"] 
    
    if req.passkey != stored_passkey[0]:
        if hasattr(conn, "close"): conn.close()
        raise HTTPException(status_code=401, detail="Invalid passkey")
    
    conn.execute("UPDATE users SET passkey_verified = 1 WHERE id = ?", (user_id,))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

@app.get("/api/auth/me")
async def get_me(user_id: str = Depends(get_current_user_id)):
    if user_id == "admin_virtual_id":
        return {
            "username": "System Administrator",
            "role": "admin",
            "passkey_verified": True
        }
    
    conn = get_db_connection()
    user = conn.execute("SELECT username, role, passkey_verified FROM users WHERE id = ?", (user_id,)).fetchone()
    if hasattr(conn, "close"): conn.close()
    
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
        
    return {"username": user[0], "role": user[1], "passkey_verified": bool(user[2])}

@app.post("/api/telegram/send-code")
async def send_code(req: PhoneLoginRequest, user_id: str = Depends(get_current_user_id)):
    try:
        # Each login can use its own API ID and Hash
        client = TelegramClient(StringSession(), int(req.api_id), req.api_hash)
        await client.connect()
        send_code_res = await client.send_code_request(req.phone_number)
        
        # Store metadata for verification step
        auth_key = f"{user_id}:{req.phone_number}"
        auth_sessions[auth_key] = {
            "client": client,
            "phone_code_hash": send_code_res.phone_code_hash,
            "api_id": req.api_id,
            "api_hash": req.api_hash
        }
        return {"phone_code_hash": send_code_res.phone_code_hash}
    except Exception as e:
        auth_key = f"{user_id}:{req.phone_number}"
        if auth_key in auth_sessions:
            await auth_sessions[auth_key]["client"].disconnect()
            auth_sessions.pop(auth_key, None)
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/telegram/verify-code")
async def verify_code(req: VerifyCodeRequest, user_id: str = Depends(get_current_user_id)):
    auth_key = f"{user_id}:{req.phone_number}"
    session_data = auth_sessions.get(auth_key)
    if not session_data:
        raise HTTPException(status_code=400, detail="Login session expired or phone number mismatch. Please request a new code.")
    
    client = session_data["client"]
    api_id = int(session_data["api_id"])
    api_hash = session_data["api_hash"]
    
    try:
        # Use the ALREADY CONNECTED client
        await client.sign_in(
            phone=req.phone_number,
            code=req.code,
            phone_code_hash=req.phone_code_hash
        )
        session_string = client.session.save()
        
        # Save to DB with API credentials
        conn = get_db_connection()
        print(f"DB: Saving account {req.phone_number} for user {user_id}")
        conn.execute(
            "INSERT INTO accounts (user_id, phone_number, session_string, api_id, api_hash, status) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, req.phone_number, session_string, str(api_id), api_hash, "active")
        )
        if hasattr(conn, "commit"): conn.commit()
        if hasattr(conn, "close"): conn.close()
        print(f"DB: Account {req.phone_number} saved successfully.")
        
        # Success cleanup
        await client.disconnect()
        auth_sessions.pop(auth_key, None)
        
        return {"status": "success", "message": "Account connected successfully."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        pass

from telethon.tl.functions.contacts import SearchRequest  # type: ignore
from telethon.tl.functions.channels import GetParticipantsRequest  # type: ignore
from telethon.tl.types import ChannelParticipantsSearch  # type: ignore

class FetchDialogsRequest(BaseModel):
    phone_number: str

class ScrapeKeywordRequest(BaseModel):
    phone_number: str
    keyword: str
    limit: int = 10

@app.post("/api/telegram/dialogs")
async def get_dialogs(req: FetchDialogsRequest, user_id: str = Depends(get_current_user_id)):
    # Fetch session from DB using phone_number
    conn = get_db_connection()
    row = conn.execute(
        "SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", 
        (req.phone_number, user_id)
    ).fetchone()
    if hasattr(conn, "close"): conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
        
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    
    dialogs_list = []
    try:
        async for dialog in client.iter_dialogs():
            if dialog.is_group or dialog.is_channel:
                dialogs_list.append({
                    "id": str(dialog.id),
                    "name": dialog.name,
                    "is_group": dialog.is_group,
                    "is_channel": dialog.is_channel
                })
        return {"dialogs": dialogs_list}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.disconnect()

@app.get("/api/telegram/accounts")
async def get_accounts(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    rows = conn.execute("SELECT phone_number, status FROM accounts WHERE user_id = ?", (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    
    accounts = []
    for row in rows:
        accounts.append({
            "phone_number": row[0],
            "status": row[1]
        })
    return {"accounts": accounts}

@app.get("/api/telegram/scrape")
async def scrape_keyword(query: str, limit: int = 500, phone_number: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    if phone_number:
        row = conn.execute("SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", (phone_number, user_id)).fetchone()
    else:
        row = conn.execute("SELECT session_string, api_id, api_hash FROM accounts WHERE user_id = ? LIMIT 1", (user_id,)).fetchone()
    if not row: raise HTTPException(status_code=404, detail="No active accounts found.")
    
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    
    groups: List[Dict[str, Any]] = []
    try:
        # Requesting a very high limit. Telegram usually caps Global Search at ~200-300 results,
        # but Telethon will try to paginate if possible or we can at least ensure we take everything we get.
        search_result = await client(SearchRequest(q=query, limit=limit))
        
        conn2 = get_db_connection()
        for chat in search_result.chats:
            # Skip deleted or restricted chats
            if not chat or getattr(chat, 'min', False): continue
            is_private = getattr(chat, 'username', None) is None
            
            # Simple country detection based on language/keywords or just "Global"
            country = "Global"
            title_str = str(getattr(chat, 'title', '')).lower()
            countries = {"nigeria": "NG", "usa": "US", "uk": "UK", "india": "IN", "crypto": "Global"}
            for k, v in countries.items():
                if k in title_str: country = v; break
            
            chat_id_str = str(getattr(chat, 'id', '0'))
            conn2.execute("INSERT INTO scrape_history (group_id, user_id) VALUES (?, ?)", (chat_id_str, user_id))
            if hasattr(conn2, "commit"): conn2.commit()

            global_count = conn2.execute("SELECT COUNT(*) FROM scrape_history WHERE group_id = ?", (chat_id_str,)).fetchone()[0]
            user_count = conn2.execute("SELECT COUNT(*) FROM scrape_history WHERE group_id = ? AND user_id = ?", (chat_id_str, user_id)).fetchone()[0]

            groups.append({
                "id": chat_id_str,
                "title": getattr(chat, 'title', 'Unknown'),
                "username": getattr(chat, 'username', None),
                "participants_count": getattr(chat, 'participants_count', 0) or getattr(chat, 'megagroup_participants', 0),
                "type": 'channel' if getattr(chat, 'broadcast', False) else 'group',
                "is_private": is_private,
                "country": country,
                "global_shows": global_count,
                "user_shows": user_count
            })
        if hasattr(conn2, "close"): conn2.close()
        return {"groups": groups}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.disconnect()

class BulkJoinRequest(BaseModel):
    group_ids: list[str]
    phone_number: str

@app.post("/api/telegram/bulk-join")
async def bulk_join(req: BulkJoinRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    row = conn.execute("SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", (req.phone_number, user_id)).fetchone()
    if not row: raise HTTPException(status_code=404, detail="Account not found")
    
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    
    results = {'joined': 0, 'failed': 0}
    try:
        from telethon.tl.functions.channels import JoinChannelRequest  # type: ignore
        for g_id in req.group_ids:
            try:
                # Human delay between joins
                await asyncio.sleep(random.randint(15, 45))
                await client(JoinChannelRequest(g_id))
                results['joined'] += 1
            except Exception as e:
                results['failed'] += 1
                print(f"Join Error {g_id}: {e}")
                if "FloodWaitError" in str(e): break
        return {"status": "success", **results}
    finally:
        await client.disconnect()

class ExtractRequest(BaseModel):
    group_id: str
    phone_number: str

@app.post("/api/telegram/extract")
async def extract_members(req: ExtractRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    row = conn.execute("SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", (req.phone_number, user_id)).fetchone()
    if hasattr(conn, "close"): conn.close()
    if not row: raise HTTPException(status_code=404, detail="Account not found")
    
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    
    try:
        # Get entity (can be a username or ID)
        entity = await client.get_entity(req.group_id if not req.group_id.lstrip('-').isdigit() else int(req.group_id))
        
        participants: List[Dict[str, Any]] = []
        offset: int = 0
        limit: int = 100
        while len(participants) < 500: # Practical limit for one go
            batch = await client(GetParticipantsRequest(
                channel=entity,
                filter=ChannelParticipantsSearch(''),
                offset=offset,
                limit=limit,
                hash=0
            ))
            if not batch.users: break
            for u in batch.users:
                if u.username or getattr(u, 'phone', None):
                    participants.append({
                        "id": str(u.id),
                        "username": str(u.username or ''),
                        "first_name": str(u.first_name or ''),
                        "last_name": str(u.last_name or '')
                    })
            offset += len(batch.users)  # type: ignore
            if len(batch.users) < limit: break
            
        # Save to Leads table
        conn = get_db_connection()
        for p in participants:
            conn.execute(
                "INSERT OR IGNORE INTO leads (user_id, group_id, username, first_name, last_name) VALUES (?, ?, ?, ?, ?)",
                (user_id, str(entity.id), p['username'], p['first_name'], p['last_name'])
            )
        if hasattr(conn, "commit"): conn.commit()
        if hasattr(conn, "close"): conn.close()

        return {"status": "success", "count": len(participants)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Extraction failed: {str(e)}")
    finally:
        await client.disconnect()

@app.post("/api/telegram/join")
async def join_group(group_id: str, phone_number: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    if phone_number:
        row = conn.execute(
            "SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", 
            (phone_number, user_id)
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT session_string, api_id, api_hash FROM accounts WHERE user_id = ? LIMIT 1", 
            (user_id,)
        ).fetchone()
    
    if hasattr(conn, "close"): conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="No accounts found")
        
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    
    try:
        await client(JoinChannelRequest(group_id))
        return {"status": "success", "message": f"Successfully joined {group_id}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.disconnect()

# Removed redundant get_accounts (already refactored earlier)

@app.get("/api/telegram/campaigns")
async def get_campaigns(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    tasks = conn.execute(
        "SELECT id, phone_number, scheduled_time, message_text, target_groups, status FROM tasks WHERE user_id = ? ORDER BY scheduled_time DESC", 
        (user_id,)
    ).fetchall()
    if hasattr(conn, "close"): conn.close()
    
    return {
        "campaigns": [
            dict(id=t[0], phone_number=t[1], schedule_time=t[2], message=t[3], groups=t[4], status=t[5]) 
            for t in tasks
        ]
    }

@app.post("/api/telegram/campaigns")
async def create_campaign(req: CampaignRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO tasks (user_id, name, phone_number, scheduled_time, message_text, target_groups, status, interval_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, req.name, req.phone_number, req.schedule_time, req.message, str(req.groups), "pending", req.interval_hours)
        )
        if hasattr(conn, "commit"): conn.commit()
        return {"status": "success", "message": "Campaign scheduled successfully."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if hasattr(conn, "close"): conn.close()

@app.get("/api/telegram/members")
async def get_members(group_id: str, phone_number: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    if phone_number:
        row = conn.execute(
            "SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", 
            (phone_number, user_id)
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT session_string, api_id, api_hash FROM accounts WHERE user_id = ? LIMIT 1", 
            (user_id,)
        ).fetchone()
    
    if hasattr(conn, "close"): conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="No accounts found")
        
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    
    members = []
    try:
        entity = await client.get_entity(group_id)
        async for user in client.iter_participants(entity, limit=100):
            members.append({
                "id": user.id,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "username": user.username,
                "is_bot": user.bot
            })
            
            # Save leads to DB for admin overview
            conn = get_db_connection()
            conn.execute(
                "INSERT INTO leads (user_id, group_id, username, first_name, last_name) VALUES (?, ?, ?, ?, ?)",
                (user_id, str(group_id), user.username, user.first_name, user.last_name)
            )
            if hasattr(conn, "commit"): conn.commit()
            if hasattr(conn, "close"): conn.close()

        return {"members": members}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.disconnect()

@app.get("/api/telegram/leads")
async def get_leads(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    leads = conn.execute(
        "SELECT id, group_id, username, first_name, last_name, created_at FROM leads WHERE user_id = ? ORDER BY created_at DESC", 
        (user_id,)
    ).fetchall()
    if hasattr(conn, "close"): conn.close()
    
    return {
        "leads": [
            dict(id=l[0], group_id=l[1], username=l[2], first_name=l[3], last_name=l[4], created_at=l[5]) 
            for l in leads
        ]
    }

# --- Admin Endpoints ---

async def get_current_admin(user_id: str = Depends(get_current_user_id)):
    print(f"AUTH_DEBUG: Checking admin rights for {user_id}")
    if user_id == "admin_virtual_id":
        return user_id
    conn = get_db_connection()
    try:
        row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            print(f"AUTH_DEBUG: User {user_id} not found in DB")
            raise HTTPException(status_code=403, detail="Admin access required: User not found")
        if row[0] != 'admin':
            print(f"AUTH_DEBUG: User {user_id} has role {row[0]}, expected admin")
            raise HTTPException(status_code=403, detail=f"Admin access required: role is {row[0]}")
        return user_id
    finally:
        if hasattr(conn, "close"): conn.close()
    return user_id

@app.post("/api/admin/maintenance/clear-leads")
async def clear_leads(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    
    conn.execute("DELETE FROM leads")
    if hasattr(conn, "commit"): conn.commit()
    return {"status": "success", "message": "All leads cleared"}

@app.post("/api/admin/maintenance/clear-tasks")
async def clear_tasks(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    
    conn.execute("DELETE FROM tasks WHERE status IN ('completed', 'failed')")
    if hasattr(conn, "commit"): conn.commit()
    return {"status": "success", "message": "Task history purged"}

@app.post("/api/admin/users/{user_id}/toggle-status")
async def admin_toggle_user_status(user_id: str, admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    user = conn.execute("SELECT is_active FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        if hasattr(conn, "close"): conn.close()
        raise HTTPException(status_code=404, detail="User not found")
    
    new_status = 0 if user[0] == 1 else 1
    conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (new_status, user_id))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success", "is_active": bool(new_status)}

@app.get("/api/admin/users/{user_id}/details")
async def admin_get_user_details(user_id: str, admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    # Accounts
    accounts = conn.execute("SELECT phone_number, status FROM accounts WHERE user_id = ?", (user_id,)).fetchall()
    # Scrape history (counts only)
    scrape_count = conn.execute("SELECT COUNT(*) FROM scrape_history WHERE user_id = ?", (user_id,)).fetchone()[0]
    # Campaign stats
    tasks = conn.execute("SELECT status, COUNT(*) FROM tasks WHERE user_id = ? GROUP BY status", (user_id,)).fetchall()
    
    if hasattr(conn, "close"): conn.close()
    
    return {
        "accounts": [dict(phone_number=a[0], status=a[1]) for a in accounts],
        "total_scrapes": scrape_count,
        "campaign_summary": dict(tasks)
    }

@app.get("/api/admin/users")
async def admin_get_users(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    users = conn.execute("SELECT id, username, role, is_active FROM users").fetchall()
    if hasattr(conn, "close"): conn.close()
    return {"users": [dict(id=u[0], username=u[1], role=u[2], is_active=u[3]) for u in users]}

@app.get("/api/admin/debug-logs")
async def get_debug_logs(admin_id: str = Depends(get_current_admin)):
    return {"logs": list(LOG_BUFFER)}

@app.get("/api/admin/stats")
async def admin_get_stats(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    total_accounts = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    total_tasks = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    total_leads = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
    
    # Per user stats
    user_stats = conn.execute('''
        SELECT u.id, u.username, u.is_active,
               (SELECT COUNT(*) FROM accounts WHERE user_id = u.id) as accounts,
               (SELECT COUNT(*) FROM tasks WHERE user_id = u.id) as tasks,
               (SELECT COUNT(*) FROM leads WHERE user_id = u.id) as leads
        FROM users u
    ''').fetchall()
    
    if hasattr(conn, "close"): conn.close()
    
    return {
        "global": {
            "users": total_users,
            "accounts": total_accounts,
            "tasks": total_tasks,
            "leads": total_leads
        },
        "per_user": [dict(id=s[0], username=s[1], is_active=bool(s[2]), accounts=s[3], tasks=s[4], leads=s[5]) for s in user_stats]
    }

@app.get("/api/dashboard/stats")
async def get_dashboard_stats(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    try:
        # Core counts
        total_accounts = conn.execute("SELECT COUNT(*) FROM accounts WHERE user_id = ?", (user_id,)).fetchone()[0]
        total_leads = conn.execute("SELECT COUNT(*) FROM leads WHERE user_id = ?", (user_id,)).fetchone()[0]
        pending_tasks = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'pending'", (user_id,)).fetchone()[0]
        
        # Approximate messages sent (completed tasks)
        messages_sent = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completed'", (user_id,)).fetchone()[0]
        
        # Get active campaigns for table
        tasks = conn.execute(
            "SELECT phone_number, status, message_text, scheduled_time FROM tasks WHERE user_id = ? ORDER BY scheduled_time DESC LIMIT 5", 
            (user_id,)
        ).fetchall()
        
        return {
            "counts": {
                "accounts": total_accounts,
                "leads": total_leads,
                "pending": pending_tasks,
                "messages": messages_sent
            },
            "recent_tasks": [
                {
                    "account": t[0],
                    "status": t[1],
                    "message": t[2],
                    "time": t[3]
                } for t in tasks
            ]
        }
    except Exception as e:
        print(f"Stats error: {e}")
        return {"counts": {"accounts": 0, "leads": 0, "pending": 0, "messages": 0}, "recent_tasks": []}
    finally:
        if hasattr(conn, "close"): conn.close()

@app.post("/api/admin/settings")
async def admin_update_settings(key: str, value: str, admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    conn.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", (key, value))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Telegram Automation API is running"}

async def task_poller():
    while True:
        try:
            conn = get_db_connection()
            # USE UTC FOR EVERYTHING. This syncs backend (server) with frontend (browser).
            now_dt = datetime.now(timezone.utc)
            now_str = now_dt.strftime('%Y-%m-%dT%H:%M')
            
            # Check for ANY pending tasks
            all_pending = conn.execute("SELECT COUNT(*) FROM tasks WHERE status = 'pending'").fetchone()
            count = all_pending[0] if all_pending else 0
            
            # Only pick pending tasks that are due now or in the past
            tasks = conn.execute(
                "SELECT id, message_text, target_groups, phone_number, user_id, interval_hours, scheduled_time FROM tasks WHERE status = 'pending' AND scheduled_time <= ?", 
                (now_str,)
            ).fetchall()
            
            if len(tasks) > 0:
                print(f"BKG_POLLER: Found {len(tasks)} tasks READY to send (Trigger: UTC {now_str})")
            elif count > 0:
                # Log the next one coming up to help user verify sync
                next_task = conn.execute("SELECT scheduled_time FROM tasks WHERE status = 'pending' ORDER BY scheduled_time ASC LIMIT 1").fetchone()
                if next_task:
                    print(f"BKG_POLLER: No tasks ready. Next up in DB: {next_task[0]} (Current Server UTC: {now_str})")

            if hasattr(conn, "close"): conn.close()

            for task_id, message, groups_str, phone_num, u_id, interval in tasks:
                print(f"BKG: Processing task {task_id} for user {u_id}")
                
                # Update status to 'processing'
                conn = get_db_connection()
                conn.execute("UPDATE tasks SET status = 'processing' WHERE id = ?", (task_id,))
                if hasattr(conn, "commit"): conn.commit()
                
                # Fetch account for this task
                acc = conn.execute(
                    "SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", 
                    (phone_num, u_id)
                ).fetchone()
                if hasattr(conn, "close"): conn.close()

                if not acc:
                    print(f"BKG: No account for {task_id}")
                    continue

                session_str, api_id, api_hash = acc[0], int(acc[1]), acc[2]
                
                try:
                    # Session string session client
                    client = TelegramClient(StringSession(session_str), api_id, api_hash)
                    await client.connect()
                    
                    import ast
                    try:
                        target_groups = ast.literal_eval(groups_str)
                    except:
                        target_groups = [groups_str] if groups_str else []

                    for group in target_groups:
                        try:
                            # 1. Human-like "Typing" delay
                            typing_delay = random.uniform(2.0, 5.0)
                            print(f"BKG: {u_id} simulating typing for {typing_delay:.1f}s...")
                            await asyncio.sleep(typing_delay)

                            # 2. Spintax support {hi|hello}
                            def spin(match):
                                options = match.group(1).split('|')
                                return random.choice(options)
                            spinned_message = re.sub(r'\{([^{}]*)\}', spin, message)
                            
                            await client.send_message(group, spinned_message)
                            
                            # 3. Inter-message randomized delay (Human interval)
                            delay = random.randint(45, 150) # Increased delay for safety
                            print(f"BKG: {u_id} sent to {group}. Next in {delay}s...")
                            await asyncio.sleep(delay)
                        except Exception as group_err:
                            print(f"BKG: Group Error ({group}): {group_err}")
                            if "FloodWaitError" in str(group_err):
                                # If we hit flood wait, stop this task for now
                                break
                    
                    await client.disconnect()

                    # Mark completed OR Re-schedule
                    conn = get_db_connection()
                    if interval > 0:
                        new_time = (datetime.now() + timedelta(hours=interval)).isoformat()
                        conn.execute("UPDATE tasks SET status = 'pending', scheduled_time = ? WHERE id = ?", (new_time, task_id))
                        print(f"BKG: Task {task_id} rescheduled for {new_time}")
                    else:
                        conn.execute("UPDATE tasks SET status = 'completed' WHERE id = ?", (task_id,))
                    
                    if hasattr(conn, "commit"): conn.commit()
                    if hasattr(conn, "close"): conn.close()
                except Exception as task_err:
                    print(f"BKG: Task {task_id} failed: {task_err}")
                    conn = get_db_connection()
                    conn.execute("UPDATE tasks SET status = 'failed' WHERE id = ?", (task_id,))
                    if hasattr(conn, "commit"): conn.commit()
                    if hasattr(conn, "close"): conn.close()

        except Exception as e:
            print(f"BKG: Poller major error: {e}")
        
        await asyncio.sleep(60) # Poll every minute

    print("CORE: System Ready.")

if __name__ == "__main__":
    import uvicorn  # type: ignore
    uvicorn.run(app, host="0.0.0.0", port=8000)

