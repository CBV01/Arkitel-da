import os
import sys
from dotenv import load_dotenv  # type: ignore
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
load_dotenv()  # Load .env file before anything else

from fastapi import FastAPI, HTTPException, Depends, status, Request  # type: ignore
from fastapi.responses import JSONResponse, StreamingResponse  # type: ignore
from pydantic import BaseModel  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from database import get_db_connection  # type: ignore
import uuid
from datetime import datetime, timedelta, timezone
import collections
import asyncio
import random
import json
import base64
from typing import Optional, List, Dict, Any, Union, cast
import re
import ast
import traceback
from contextlib import asynccontextmanager
import httpx  # pyre-ignore[21]
try:
    from bs4 import BeautifulSoup  # type: ignore
    BS4_AVAILABLE = True
except ImportError:
    BS4_AVAILABLE = False
    print("WARNING: beautifulsoup4 not installed. Directory scraping disabled. Run: pip install beautifulsoup4 lxml")

# Telethon Imports
from telethon.sync import TelegramClient  # type: ignore
from telethon.sessions import StringSession  # type: ignore
from telethon.tl.functions.channels import JoinChannelRequest, GetParticipantsRequest  # type: ignore
from telethon.tl.functions.messages import SearchGlobalRequest, CheckChatInviteRequest, ImportChatInviteRequest  # type: ignore
from telethon.tl.functions.contacts import SearchRequest # type: ignore
from telethon.tl.types import ChannelParticipantsSearch, InputMessagesFilterEmpty, InputPeerEmpty, InputPeerChannel, InputPeerChat # type: ignore
from telethon.tl.functions.help import GetConfigRequest # type: ignore
from fastapi.staticfiles import StaticFiles # type: ignore

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
        from database import init_db  # type: ignore
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
    
    # Close pool
    await POOL.disconnect_all()
    print("CORE: All clients disconnected. Shutdown complete.")

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

app = FastAPI(title="ArkiTel Automation API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, set this to process.env.FRONTEND_URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files for profile photos
if not os.path.exists("static/avatars"):
    os.makedirs("static/avatars", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

async def fetch_tg_profile_data(client: TelegramClient, phone_number: str):
    """Fetches profile details and downloads photo for an authenticated client."""
    me = await client.get_me()
    first_name = getattr(me, 'first_name', '')
    last_name = getattr(me, 'last_name', '')
    username = getattr(me, 'username', '')
    
    # Try to get country from phone number prefix
    country = "Unknown"
    if phone_number.startswith('+'):
        # Very basic mapping, ideally use a library
        prefixes = {"+1": "USA", "+44": "UK", "+234": "Nigeria", "+91": "India", "+62": "Indonesia"}
        for p, c in prefixes.items():
            if phone_number.startswith(p):
                country = c
                break

    # Download profile photo
    photo_path = None
    try:
        user_id = getattr(me, 'id', 0)
        user_photo = getattr(me, 'photo', None)
        if user_photo:
            filename = f"avatar_{user_id}.jpg"
            save_path = f"static/avatars/{filename}"
            await client.download_profile_photo(me, file=save_path)
            photo_path = f"/static/avatars/{filename}"
    except Exception as e:
        print(f"BKG: Photo download error: {e}")
        
    return {
        "first_name": first_name,
        "last_name": last_name,
        "username": username,
        "profile_photo": photo_path,
        "country": country
    }


@app.get("/api/debug/db")
async def debug_db():
    url = os.getenv("TURSO_DATABASE_URL", "NOT_SET")
    token = os.getenv("TURSO_AUTH_TOKEN", "NOT_SET")
    u_str = str(url) if url else "NOT_SET"
    display_url = "NOT_SET"
    if u_str != "NOT_SET":
        d_url = ""
        for i, char in enumerate(u_str):
            if i >= 20: break
            d_url += char
        display_url = d_url + "..."
    return {
        "url": display_url,
        "token_set": bool(token and token != "NOT_SET"),
        "env_file_exists": os.path.exists(".env")
    }

async def resolve_tg_entity(client, target):
    """Smarter handle resolver for Telegram joining."""
    try:
        # 1. Try resolving directly (ID or Username)
        resolved_id = target
        if str(target).lstrip('-').isdigit():
            resolved_id = int(target)
        entity = await client.get_entity(resolved_id)
        return entity
    except Exception:
        # 2. Try cleaning username
        if isinstance(target, str) and target.startswith('@'):
            try:
                username = target.replace('@', '', 1)
                entity = await client.get_entity(username)
                return entity
            except: pass
        
        # 3. Try resolving as invite link
        if isinstance(target, str) and ("t.me/joinchat/" in target or "t.me/+" in target):
            hash_val = target.split('/')[-1].replace('+', '')
            try:
                # We can't return an entity directly from an invite link easily without joining
                # But we can return the hash to be used in ImportChatInviteRequest
                return ("invite", hash_val)
            except: pass
    return None

async def smart_join(client, target):
    """Joins a group/channel using the best available method."""
    from telethon.tl.functions.channels import JoinChannelRequest # type: ignore
    from telethon.tl.functions.messages import ImportChatInviteRequest # type: ignore
    
    res = await resolve_tg_entity(client, target)
    if not res:
        raise Exception(f"Could not resolve entity for {target}")
        
    if isinstance(res, tuple) and res[0] == "invite":
        return await client(ImportChatInviteRequest(res[1]))
    else:
        return await client(JoinChannelRequest(res))

from fastapi import Request  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore
import traceback

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"GLOBAL_ERROR: {str(exc)}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        # NOTE: Traceback intentionally NOT returned to client for security
        content={"detail": "Internal Server Error. Please try again or contact support."},
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
qr_sessions: Dict[str, Dict[str, Any]] = {}

class TelegramPool:
    """Manages a pool of persistent Telegram clients for low-latency operations."""
    def __init__(self):
        # Key: (user_id, phone_number)
        self._clients: Dict[tuple, TelegramClient] = {}
        self._locks: Dict[tuple, asyncio.Lock] = {}

    async def get_client(self, user_id: str, phone_number: str) -> TelegramClient:
        key = (user_id, phone_number)
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
            
        async with self._locks[key]:
            # If we already have a client, verify it's still alive
            if key in self._clients:
                client = self._clients[key]
                if client.is_connected():
                    try:
                        # Lightweight health check
                        await client.get_me() 
                        return client
                    except Exception:
                        log_debug(f"POOL: Client for {phone_number} lost connection or died. Reconnecting...")
                        try: await client.disconnect()
                        except: pass
                
            # Create a new connection instance
            conn = get_db_connection()
            # Admins can access ANY account. Regular users only their own.
            if user_id == "admin_virtual_id":
                row = conn.execute(
                    "SELECT session_string, api_id, api_hash, user_id FROM accounts WHERE phone_number = ?", 
                    (phone_number,)
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT session_string, api_id, api_hash, user_id FROM accounts WHERE phone_number = ? AND user_id = ?", 
                    (phone_number, user_id)
                ).fetchone()
            
            if hasattr(conn, "close"): conn.close()
            
            if not row:
                raise HTTPException(status_code=404, detail=f"Account {phone_number} not found or unauthorized.")
                
            session_str, api_id, api_hash, actual_owner_id = row[0], int(row[1]), row[2], row[3]
            
            # Map back to the ACTUAL owner to avoid duplicate client instances in pool
            key = (actual_owner_id, phone_number)
            
            log_debug(f"POOL: Booting new persistent node for {phone_number}")
            new_client = TelegramClient(StringSession(session_str), int(api_id), api_hash)
            await new_client.connect()
            
            if not await new_client.is_user_authorized():
                await new_client.disconnect()
                # Update DB status
                conn = get_db_connection()
                conn.execute("UPDATE accounts SET status = 'expired', status_detail = 'Auth token invalid' WHERE phone_number = ?", (phone_number,))
                if hasattr(conn, "commit"): conn.commit()
                if hasattr(conn, "close"): conn.close()
                raise HTTPException(status_code=401, detail=f"Session for {phone_number} has expired.")
                
            # Mark as active
            conn = get_db_connection()
            conn.execute("UPDATE accounts SET status = 'active', status_detail = 'Pooled & Ready', last_active = ? WHERE phone_number = ?", (datetime.now(), phone_number))
            if hasattr(conn, "commit"): conn.commit()
            if hasattr(conn, "close"): conn.close()
            
            self._clients[key] = new_client
            return new_client

    async def disconnect_all(self):
        """Cleans up all clients on server shutdown."""
        log_debug(f"POOL: Terminating {len(self._clients)} active node sessions...")
        for client in self._clients.values():
            try:
                await client.disconnect()
            except:
                pass
        self._clients.clear()

# Initialize Global Instance
POOL = TelegramPool()

async def qr_login_worker(client: TelegramClient, qr, user_id, api_id, api_hash, token):
    """Background task to wait for QR scan and save the session."""
    try:
        print(f"QR_WORKER[{token}]: Waiting for user scan...")
        user = await qr.wait()
        print(f"QR_WORKER[{token}]: Scan SUCCESS. Logged in as ID {user.id}")
        
        # Login success! Get full profile
        me = await client.get_me()
        user_id_val = getattr(me, 'id', 0)
        phone = getattr(me, 'phone', f"ID_{user_id_val}")
        # Fetch profile data and ensure it's fully resolved
        profile_data = await fetch_tg_profile_data(client, phone)
        profile: Dict[str, Any] = cast(Dict[str, Any], profile_data)
        session_string = str(client.session.save()) # type: ignore
        
        # Save to DB
        conn = get_db_connection()
        # Check if already exists
        existing = conn.execute("SELECT 1 FROM accounts WHERE phone_number = ?", (phone,)).fetchone()
        if existing:
             conn.execute(
                """UPDATE accounts SET user_id = ?, session_string = ?, api_id = ?, api_hash = ?, 
                   first_name = ?, last_name = ?, username = ?, profile_photo = ?, country = ?, status = 'active' 
                   WHERE phone_number = ?""",
                (user_id, session_string, str(api_id), api_hash, 
                 profile['first_name'], profile['last_name'], profile['username'], 
                 profile['profile_photo'], profile['country'], phone)
            )
        else:
            conn.execute(
                """INSERT INTO accounts (user_id, phone_number, session_string, api_id, api_hash, 
                   first_name, last_name, username, profile_photo, country, status) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (user_id, phone, session_string, str(api_id), api_hash,
                 profile['first_name'], profile['last_name'], profile['username'], 
                 profile['profile_photo'], profile['country'], "active")
            )
        if hasattr(conn, "commit"): conn.commit()
        if hasattr(conn, "close"): conn.close()
        
        # Update session state
        if token in qr_sessions:
            qr_sessions[token]["status"] = "success"
            qr_sessions[token]["phone"] = phone
            print(f"QR_WORKER[{token}]: Account {phone} saved to database.")
            
    except Exception as e:
        print(f"QR_WORKER[{token}]: ERROR: {str(e)}")
        if token in qr_sessions:
            qr_sessions[token]["status"] = "error"
            qr_sessions[token]["error"] = str(e)
    finally:
        # We don't disconnect immediately because we might need the client for another second
        # but the status poll will pop it from the dict anyway.
        pass


class UserRegister(BaseModel):
    username: str
    password: str

class PasskeyVerify(BaseModel):
    passkey: str

class PhoneLoginRequest(BaseModel):
    phone_number: str
    api_id: Optional[str] = None
    api_hash: Optional[str] = None

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
    print(f"AUTH: Registered new user {user.username} with ID {user_id}")
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
    # Fallback to defaults from environment/config
    api_id = req.api_id or TELEGRAM_API_ID
    api_hash = req.api_hash or TELEGRAM_API_HASH

    if not api_id or not api_hash:
        # Telegram iOS credentials - more stable than Android ones
        api_id = "2040"
        api_hash = "b18441a1ff607e10a989891a5462e627"
        
    try:
        # Each login can use its own API ID and Hash
        client = TelegramClient(StringSession(), int(api_id), api_hash)
        await client.connect()
        send_code_res = await client.send_code_request(req.phone_number)
        
        # Store metadata for verification step
        auth_key = f"{user_id}:{req.phone_number}"
        auth_sessions[auth_key] = {
            "client": client,
            "phone_code_hash": send_code_res.phone_code_hash,
            "api_id": str(api_id),
            "api_hash": api_hash
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
        # Success! Fetch profile
        profile_data = await fetch_tg_profile_data(client, req.phone_number)
        profile: Dict[str, Any] = cast(Dict[str, Any], profile_data)
        session_string = str(client.session.save()) # type: ignore
        
        # Save to DB with API credentials
        conn = get_db_connection()
        print(f"DB: Saving account {req.phone_number} for user {user_id}")
        
        # Check if already exists
        existing = conn.execute("SELECT 1 FROM accounts WHERE phone_number = ?", (req.phone_number,)).fetchone()
        if existing:
            conn.execute(
                """UPDATE accounts SET user_id = ?, session_string = ?, api_id = ?, api_hash = ?, 
                   first_name = ?, last_name = ?, username = ?, profile_photo = ?, country = ?, status = 'active' 
                   WHERE phone_number = ?""",
                (user_id, session_string, str(api_id), api_hash, 
                 profile['first_name'], profile['last_name'], profile['username'], 
                 profile['profile_photo'], profile['country'], req.phone_number)
            )
        else:
            conn.execute(
                """INSERT INTO accounts (user_id, phone_number, session_string, api_id, api_hash, 
                   first_name, last_name, username, profile_photo, country, status) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (user_id, req.phone_number, session_string, str(api_id), api_hash,
                 profile['first_name'], profile['last_name'], profile['username'], 
                 profile['profile_photo'], profile['country'], "active")
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
    try:
        client = await POOL.get_client(user_id, req.phone_number)
        dialogs_list = []
        # Added limit to avoid long timeouts on large accounts (200 is usually enough for campaigns)
        async for dialog in client.iter_dialogs(limit=200):
            if dialog.is_group or dialog.is_channel:
                name = getattr(dialog, 'name', '') or getattr(dialog, 'title', '') or str(dialog.id)
                dialogs_list.append({
                    "id": str(dialog.id),
                    "name": name,
                    "title": name,
                    "is_group": dialog.is_group,
                    "is_channel": dialog.is_channel
                })
        return {"dialogs": dialogs_list}
    except Exception as e:
        log_debug(f"DIALOGS_ERROR for {req.phone_number}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Could not fetch dialogs: {str(e)}")

@app.post("/api/telegram/qr/init")
async def qr_init(user_id: str = Depends(get_current_user_id)):
    try:
        api_id = int(os.getenv("TELEGRAM_API_ID", "2040"))
        api_hash = os.getenv("TELEGRAM_API_HASH", "b18441a1ff607e10a989891a5462e627")
        
        client = TelegramClient(StringSession(''), api_id, api_hash)
        await client.connect()
        
        qr = await client.qr_login()
        token = str(uuid.uuid4())
        qr_sessions[token] = {
            "client": client,
            "qr": qr,
            "user_id": user_id,
            "api_id": api_id,
            "api_hash": api_hash,
            "created_at": datetime.now(),
            "status": "pending"
        }
        
        # Trigger background waiter
        asyncio.create_task(qr_login_worker(client, qr, user_id, api_id, api_hash, token))
        
        return {"token": token, "url": qr.url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"QR init failed: {str(e)}")

@app.get("/api/telegram/qr/status/{token}")
async def qr_status(token: str):
    sess = qr_sessions.get(token)
    if not sess:
        return {"status": "expired"}
        
    status = sess.get("status", "pending")
    
    if status == "success":
        phone = sess.get("phone")
        # Pop only after success is consumed
        qr_sessions.pop(token, None)
        return {"status": "success", "phone": phone}
    
    if status == "error":
        err = sess.get("error", "Unknown error")
        qr_sessions.pop(token, None)
        return {"status": "error", "detail": err}
        
    # Check for timeout (5 minutes)
    if datetime.now() - sess["created_at"] > timedelta(minutes=5):
        qr_sessions.pop(token, None)
        return {"status": "expired"}
        
    return {"status": "pending"}

@app.get("/api/telegram/accounts")
async def get_accounts(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    if user_id == "admin_virtual_id":
        # Admin sees all accounts in the system
        rows = conn.execute("""
            SELECT phone_number, status, api_id, api_hash, 
                   first_name, last_name, username, profile_photo, country, created_at 
            FROM accounts
        """).fetchall()
    else:
        # Regular user only sees their own accounts
        rows = conn.execute("""
            SELECT phone_number, status, api_id, api_hash, 
                   first_name, last_name, username, profile_photo, country, created_at 
            FROM accounts WHERE user_id = ?
        """, (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    
    accounts = []
    for row in rows:
        accounts.append({
            "phone_number": row[0],
            "status": row[1],
            "api_id": row[2],
            "api_hash": row[3],
            "first_name": row[4],
            "last_name": row[5],
            "username": row[6],
            "profile_photo": row[7],
            "country": row[8],
            "created_at": row[9]
        })
    return {"accounts": accounts}
@app.delete("/api/telegram/accounts/{phone_number}")
async def delete_account(phone_number: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    conn.execute("DELETE FROM accounts WHERE phone_number = ? AND user_id = ?", (phone_number, user_id))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    print(f"AUTH: Account {phone_number} deleted by user {user_id}")
    return {"status": "success"}

@app.post("/api/telegram/accounts/{phone_number}/validate")
async def validate_account_session(phone_number: str, user_id: str = Depends(get_current_user_id)):
    try:
        client = await POOL.get_client(user_id, phone_number)
        is_auth = await client.is_user_authorized()
        return {"status": "success", "authorized": is_auth}
    except Exception as e:
        return {"status": "error", "message": f"Session verification failed: {str(e)}"}

@app.get("/api/telegram/accounts/{phone_number}/session")
async def dump_session_string(phone_number: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    row = conn.execute("SELECT session_string FROM accounts WHERE phone_number = ? AND user_id = ?", (phone_number, user_id)).fetchone()
    if hasattr(conn, "close"): conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    
    return {"phone_number": phone_number, "session_string": row[0]}


# ─────────────────────────────────────────────────────────────────────────────
# HYBRID SCRAPER HELPERS  (Layer 2 & 3: web directories)
# ─────────────────────────────────────────────────────────────────────────────

SCRAPER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

def save_scraped_group(user_id: str, item: Dict[str, Any]):
    """Helper to save a detected group/channel to the database immediately."""
    try:
        conn = get_db_connection()
        gid = item.get('id')
        if not gid: return
        
        # Save to history
        conn.execute("INSERT OR IGNORE INTO scrape_history (group_id, user_id) VALUES (?, ?)", (str(gid), user_id))
        
        # Save to persistent leads table
        conn.execute(
            """INSERT OR REPLACE INTO scraped_groups 
               (id, user_id, title, username, participants_count, type, is_private, country, user_shows, global_shows, source) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (str(gid), user_id, item.get('title', 'Unknown'), item.get('username'), item.get('participants_count', 0), 
             item.get('type', 'group'), 1 if item.get('is_private') else 0, item.get('country', 'Global'), 
             item.get('user_shows', 1), item.get('global_shows', 1), item.get('source', 'scraper'))
        )
        if hasattr(conn, "commit"): conn.commit()
        if hasattr(conn, "close"): conn.close()
    except Exception as e:
        print(f"Error auto-saving lead: {e}")

async def _scrape_lyzem(base_query: str, max_pages: int = 10, queue: Optional[asyncio.Queue] = None, user_id: str = "") -> List[Dict[str, Any]]:
    """Scrape lyzem.com custom search engine for Telegram. Verified working."""
    if not BS4_AVAILABLE:
        return []
    results: List[Dict[str, Any]] = []
    seen: set = set()
    try:
        async with httpx.AsyncClient(headers=SCRAPER_HEADERS, timeout=15, follow_redirects=True) as client:
            for page in range(1, max_pages + 1):
                url = f"https://lyzem.com/search?q={base_query}&p={page}"
                try:
                    if queue: await queue.put({"type": "progress", "msg": f"Lyzem: Scanning Page {page}/{max_pages}..."}) # type: ignore
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        break
                    
                    soup = BeautifulSoup(resp.text, "lxml")
                    # Lyzem typically has <a> tags linking to telegram
                    links = soup.select("a[href*='t.me/']")
                    
                    found_on_page = 0
                    for link in links: # type: ignore
                        href = link.get("href", "") # type: ignore
                        m = re.search(r'(?:t\.me|telegram\.me)/([^/?#\s]+)', href)
                        if not m:
                            continue
                        
                        username = m.group(1).lower()
                        if username in seen or username.lower() in ('joinchat', 'share', 'addstickers', 'iv'):
                            continue
                            
                        seen.add(username)
                        
                        # Find the parent container to extract title and members if possible
                        parent = link.find_parent("div", class_=re.compile(r'result|card|item'))
                        title = link.get_text(strip=True) or username
                        
                        members = 0
                        if parent:
                            members_text = parent.get_text()
                            m_match = re.search(r'([\d,]+)\s*(?:subscribers|members)', members_text, re.IGNORECASE)
                            if m_match:
                                members = int(re.sub(r'\D', '', m_match.group(1)))
                                
                        
                        item = {
                            "id": f"@{username}",
                            "title": title,
                            "username": username,
                            "participants_count": members,
                            "type": "channel", # Lyzem mostly indexes channels
                            "is_private": False,
                            "country": "Global",
                            "global_shows": 1,
                            "user_shows": 1,
                            "source": "lyzem"
                        }
                        results.append(item)
                        # Fire and forget save to not block the stream
                        if user_id: asyncio.create_task(asyncio.to_thread(lambda: save_scraped_group(user_id, item))) # type: ignore
                        if queue:
                            await queue.put({"type": "result", "layer": 2, "data": item})  # type: ignore
                            
                        found_on_page += 1
                        
                    print(f"SCRAPER[lyzem] page {page}: +{found_on_page} results")
                    if found_on_page == 0:
                        break
                    await asyncio.sleep(1.0) # Polite delay
                except Exception as page_err:
                    print(f"SCRAPER[lyzem] page {page} error: {page_err}")
                    break
    except Exception as e:
        print(f"SCRAPER[lyzem] fatal error: {e}")
    return results


async def _scrape_telegram_search(base_query: str, rows: list, queue: Optional[asyncio.Queue] = None, user_id: str = "") -> Dict[str, Dict[str, Any]]:
    """Layer 1: Use Telegram API contacts.search with many keyword variations."""
    unique_groups: Dict[str, Dict[str, Any]] = {}
    
    # Build maximally broad variation list
    search_queries = [base_query]
    suffixes = [
        "official", "group", "channel", "community", "chat", "hub",
        "network", "team", "zone", "world", "global", "vip", "pro",
        "2", "3", "online", "free", "live", "top", "best", "new",
        "real", "original", "main", "updates", "news", "info",
        "global chat", "portal", "support", "service", "market",
        "store", "shop", "deals", "premium", "lite", "backup",
        "archive", "community hub", "discussion", "lounge",
        "broadcast", "alerts", "notices", "leads", "clients",
        "customers", "hq", "international", "connect", "links",
        "services", "help", "prices", "vip access", "admin"
    ]
    for suffix in suffixes:
        search_queries.append(f"{base_query} {suffix}")
    
    # Numeric variants for short single-word keywords
    if " " not in base_query and len(base_query) < 15:
        for n in ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]:
            search_queries.append(f"{base_query}{n}")

    print(f"SCRAPER[telegram] {len(search_queries)} variations × {len(rows)} accounts = "
          f"up to {len(search_queries) * len(rows) * 100} raw results")

    for row in rows:
        acc_phone = row[3]
        try:
            client = await POOL.get_client(user_id, acc_phone)
            for q in search_queries:
                try:
                    if queue: await queue.put({"type": "progress", "msg": f"TG Search: Testing '{q}'..."}) # type: ignore
                    search_result = await client(SearchRequest(q=q, limit=100))
                    for chat in search_result.chats:
                        if not chat:
                            continue
                        chat_id_str = str(getattr(chat, 'id', '0'))
                        
                        # Membership check
                        is_member = not getattr(chat, 'left', True)
                        
                        if chat_id_str in unique_groups:
                            if is_member: unique_groups[chat_id_str]["is_member"] = True  # type: ignore
                            continue
                            
                        is_private = getattr(chat, 'username', None) is None
                        title = getattr(chat, 'title', 'Unknown')
                        username = getattr(chat, 'username', None)
                        participants_count = (
                            getattr(chat, 'participants_count', 0)
                            or getattr(chat, 'megagroup_participants', 0)
                            or 0
                        )
                        chat_type = 'channel' if getattr(chat, 'broadcast', False) else 'group'
                        item = {
                            "id": chat_id_str,
                            "title": title,
                            "username": username,
                            "participants_count": participants_count,
                            "type": chat_type,
                            "is_private": is_private,
                            "country": "Global",
                            "global_shows": 1,
                            "user_shows": 1,
                            "source": "telegram",
                            "is_member": is_member
                        }
                        unique_groups[chat_id_str] = item
                        # Auto-saving disabled as per user request (manual save only)
                        # if user_id: asyncio.create_task(asyncio.to_thread(lambda: save_scraped_group(user_id, item))) # type: ignore
                        if queue:
                            await queue.put({"type": "result", "layer": 1, "data": item})  # type: ignore
                    
                    # Phrase-based Global Message Search (Discovery Hack)
                    # If query has multiple words or is an intent phrase, search globally for messages
                    if len(q.split()) > 1 or any(x in q.lower() for x in ["need", "who", "build", "looking"]):
                        from telethon.tl.functions.messages import SearchGlobalRequest # type: ignore
                        from telethon.tl.types import InputMessagesFilterEmpty # type: ignore
                        try:
                            msg_results = await client(SearchGlobalRequest(
                                q=q,
                                filter=InputMessagesFilterEmpty(),
                                min_date=None,
                                max_date=None,
                                offset_id=0,
                                offset_peer=InputPeerEmpty(),
                                limit=20
                            ))
                            for msg in msg_results.messages:
                                try:
                                    chat = await msg.get_chat()
                                    if not chat: continue
                                    cid = str(getattr(chat, 'id', '0'))
                                    if cid not in unique_groups:
                                        username = getattr(chat, 'username', None)
                                        is_member = not getattr(chat, 'left', True)
                                        item = {
                                            "id": cid,
                                            "title": getattr(chat, 'title', 'Unknown'),
                                            "username": username,
                                            "participants_count": getattr(chat, 'participants_count', 0),
                                            "type": 'channel' if getattr(chat, 'broadcast', False) else 'group',
                                            "is_private": username is None,
                                            "country": "Global",
                                            "global_shows": 1,
                                            "user_shows": 1,
                                            "source": "telegram_msg",
                                            "is_member": is_member
                                        }
                                        unique_groups[cid] = item
                                        if queue:
                                            await queue.put({"type": "result", "layer": 1, "data": item}) # type: ignore
                                except: continue
                        except: pass

                    await asyncio.sleep(0.4)
                except Exception as q_err:
                    print(f"SCRAPER[telegram] query='{q}' acc={acc_phone} err: {q_err}")
                    continue
        except Exception as e:
            print(f"SCRAPER[telegram] account {acc_phone} connection error: {e}")
        finally:
            await client.disconnect()
    
    return unique_groups


async def _scrape_spider(seed_groups: List[Dict[str, Any]], rows: list, max_seeds: int = 15, queue: Optional[asyncio.Queue] = None, user_id: str = "") -> List[Dict[str, Any]]:
    """Layer 3: Spider Crawler. Reads recent messages of deep channels to find forwarded links and mentions."""
    results = []
    seen = set()
    
    # Extract public channels from the seed groups
    public_seeds = [g for g in seed_groups if g.get('username') and not g.get('is_private')]
    
    # Sort by participants count to spider the largest groups (more likely to have ads/forwards)
    public_seeds.sort(key=lambda x: int(x.get('participants_count', 0)), reverse=True)
    targets = list(public_seeds)[:max_seeds]  # type: ignore
    
    if not targets or not rows:
        return []
        
    print(f"SCRAPER[spider] Starting deep crawl on {len(targets)} prominent channels...")
    
    # Connect with the first available active account for spidering
    session_str, api_id, api_hash, acc_phone = rows[0][0], int(rows[0][1]), rows[0][2], rows[0][3]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return []
            
        for seed in targets:
            try:
                username = seed['username']
                entity = await client.get_entity(username)
                
                # Get last 50 messages
                messages = await client.get_messages(entity, limit=50)  # type: ignore
                
                found_in_seed: int = 0
                for msg in messages:  # type: ignore
                    # Look for forwards
                    if hasattr(msg, 'forward') and msg.forward and getattr(msg.forward, 'chat', None):  # type: ignore
                        f_chat = msg.forward.chat  # type: ignore
                        f_username = getattr(f_chat, 'username', None)
                        if f_username:
                            l_lower = f_username.lower()
                            if l_lower not in seen:
                                seen.add(l_lower)
                                item = {
                                    "id": f"@{f_username}",
                                    "title": getattr(f_chat, 'title', f_username),
                                    "username": f_username,
                                    "participants_count": getattr(f_chat, 'participants_count', 0) or getattr(f_chat, 'megagroup_participants', 0) or 0,
                                    "type": 'channel' if getattr(f_chat, 'broadcast', False) else 'group',
                                    "is_private": False,
                                    "country": "Global",
                                    "global_shows": 1,
                                    "user_shows": 1,
                                    "source": "spider"
                                }
                                results.append(item)
                                if user_id: save_scraped_group(user_id, item)
                                if queue:
                                    await queue.put({"type": "result", "layer": 3, "data": item})  # pyre-ignore
                                found_in_seed = int(found_in_seed) + 1  # type: ignore
                    
                    # Look for t.me links or @mentions in text
                    if msg.text:
                        # Find t.me/xxxxx
                        links = re.findall(r'(?:t\.me|telegram\.me)/([^/?#\s\'\"]+)', msg.text)
                        # Find @xxxxx
                        mentions = re.findall(r'@([a-zA-Z0-9_]{5,32})', msg.text)
                        
                        for l in links + mentions:
                            l_lower = l.lower()
                            if l_lower not in seen and l_lower not in ('joinchat', 'share', 'addstickers', 'iv'):
                                seen.add(l_lower)
                                item2 = {
                                    "id": f"@{l_lower}",
                                    "title": l,
                                    "username": l_lower,
                                    "participants_count": 0,
                                    "type": "channel", # guess
                                    "is_private": False,
                                    "country": "Global",
                                    "global_shows": 1,
                                    "user_shows": 1,
                                    "source": "spider"
                                }
                                results.append(item2)
                                # Auto-saving disabled as per user request (manual save only)
                                # if user_id: asyncio.create_task(asyncio.to_thread(lambda: save_scraped_group(user_id, item2))) # type: ignore
                                if queue:
                                    await queue.put({"type": "result", "layer": 3, "data": item2})  # pyre-ignore
                                found_in_seed = int(found_in_seed) + 1  # type: ignore
                
                if int(found_in_seed) > 0:  # type: ignore
                    print(f"SCRAPER[spider] Crawled @{username} -> found {found_in_seed} new links")
                await asyncio.sleep(0.5)
                
            except Exception as e:
                # Expected if channel is private or deleted
                continue
                
    except Exception as e:
        print(f"SCRAPER[spider] Fatal error: {e}")
    finally:
        await client.disconnect()

    return results


@app.get("/api/telegram/scrape_stream")
async def scrape_keyword_stream(
    query: str,
    country: Optional[str] = None,
    limit: int = 100,
    phone_number: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    conn = get_db_connection()
    if phone_number:
        rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE phone_number = ? AND user_id = ?", (phone_number, user_id)).fetchall()
    else:
        rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE user_id = ? AND status = 'active'", (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    if not rows: raise HTTPException(status_code=404, detail="No active accounts found.")

    base_query = query.strip()
    if country:
        base_query = f"{base_query}{country}"

    queue = asyncio.Queue()

    async def scraper_task():
        try:
            await queue.put({"type": "progress", "msg": f"Layer 1 & 2: Scanning Telegram API & Lyzem Engine for '{base_query}'..."})  # pyre-ignore
            
            t_task = asyncio.create_task(_scrape_telegram_search(base_query, rows, queue, user_id))
            l_task = asyncio.create_task(_scrape_lyzem(base_query, 10, queue, user_id))
            t_res, l_res = await asyncio.gather(t_task, l_task, return_exceptions=True)
            
            ug = {}
            if isinstance(t_res, dict): ug.update(t_res)
            for item in (l_res if isinstance(l_res, list) else []):
                k = f"@{item.get('username', '')}"
                if k not in ug and item.get('username'): ug[k] = item
            
            await queue.put({"type": "progress", "msg": f"Layer 3: Spidering {len(ug)} prominent groups..."})  # pyre-ignore
            s_res = await _scrape_spider(list(ug.values()), rows, 15, queue, user_id)
            
            # Background auto-saving already handled by helper inside scrapers

            await queue.put({"type": "done", "msg": "Scrape completed"})  # pyre-ignore
        except asyncio.CancelledError:
            print("SCRAPER_STREAM canceled by client disconnect")
            raise
        except Exception as e:
            await queue.put({"type": "error", "msg": str(e)})  # pyre-ignore

    # Start explicitly outside event_generator
    bg_task = asyncio.create_task(scraper_task())

    async def event_generator():
        try:
            while True:
                msg = await queue.get()  # pyre-ignore
                yield f"data: {json.dumps(msg)}\n\n"
                if msg["type"] in ["done", "error"]:
                    break
        except asyncio.CancelledError:
            bg_task.cancel()
            print("Client disconnected, stopping scraper stream task.")
            raise

    response = StreamingResponse(event_generator(), media_type="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Connection"] = "keep-alive"
    return response

@app.get("/api/telegram/scrape")
async def scrape_keyword(
    query: str,
    limit: int = 100,
    phone_number: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    conn = get_db_connection()
    if phone_number:
        rows = conn.execute(
            "SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE phone_number = ? AND user_id = ?",
            (phone_number, user_id)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE user_id = ? AND status = 'active'",
            (user_id,)
        ).fetchall()
    if hasattr(conn, "close"):
        conn.close()

    if not rows:
        raise HTTPException(status_code=404, detail="No active accounts found.")

    base_query = query.strip()

    # Run layers concurrently
    print(f"SCRAPER: Starting hybrid search for '{base_query}' (Telegram API + Lyzem Crawler)")
    telegram_task = asyncio.create_task(_scrape_telegram_search(base_query, rows))
    lyzem_task    = asyncio.create_task(_scrape_lyzem(base_query, max_pages=10))

    telegram_results, lyzem_results = await asyncio.gather(
        telegram_task, lyzem_task, return_exceptions=True
    )

    # Merge — Telegram results keyed by numeric ID, directory results keyed by @username
    unique_groups: Dict[str, Dict[str, Any]] = {}

    if isinstance(telegram_results, dict):
        unique_groups.update(telegram_results)

    for item in (lyzem_results if isinstance(lyzem_results, list) else []):
        key = f"@{item.get('username', '')}"
        if key not in unique_groups and item.get('username'):
            unique_groups[key] = item

    # LAYER 3: Spider Crawler
    print(f"SCRAPER: Starting Layer 3 (Spider Crawler) based on top results...")
    spider_results = await _scrape_spider(list(unique_groups.values()), rows)
    for item in spider_results:
        key = f"@{item.get('username', '')}"
        if key not in unique_groups and item.get('username'):
            unique_groups[key] = item
            
    final_list = list(unique_groups.values())

    # Auto-saving to scraped_groups disabled as per user request
    # Manual save will be triggered via /api/telegram/leads/groups/bulk-save
    
    # Record only to history (discovery log)
    conn2 = get_db_connection()
    for item in final_list:
        gid = item.get('id')
        if not gid: continue
        conn2.execute("INSERT OR IGNORE INTO scrape_history (group_id, user_id) VALUES (?, ?)", (gid, user_id))
    
    if hasattr(conn2, "commit"): conn2.commit()
    if hasattr(conn2, "close"): conn2.close()

    print(f"SCRAPER: Done — {len(final_list)} unique results for '{base_query}' "
          f"(TG:{len(telegram_results) if isinstance(telegram_results, dict) else 0} "
          f"Lyzem:{len(lyzem_results) if isinstance(lyzem_results, list) else 0} "
          f"Spider:{len(spider_results)})")

    return {"groups": final_list}

class BulkJoinRequest(BaseModel):
    group_ids: list[str]
    phone_number: str

@app.post("/api/telegram/bulk-join")
async def bulk_join(req: BulkJoinRequest, user_id: str = Depends(get_current_user_id)):
    """Legacy non-streaming bulk join (kept for compatibility). Use /stream for real-time tracking."""
    conn = get_db_connection()
    row = conn.execute("SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", (req.phone_number, user_id)).fetchone()
    if hasattr(conn, "close"): conn.close()
    if not row: raise HTTPException(status_code=404, detail="Account not found")
    
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    
    results = {'joined': 0, 'failed': 0}
    try:
        from telethon.tl.functions.channels import JoinChannelRequest  # pyre-ignore[21]
        for g_id in req.group_ids:
            try:
                await asyncio.sleep(random.randint(10, 15))
                resolved_id = int(g_id) if str(g_id).lstrip('-').isdigit() else g_id
                entity = await client.get_entity(resolved_id)
                await client(JoinChannelRequest(entity))
                results['joined'] += 1
            except Exception as e:
                results['failed'] += 1
                if "FloodWaitError" in str(e): break
        return {"status": "success", **results}
    finally:
        await client.disconnect()


@app.get("/api/telegram/bulk-join/stream")
async def bulk_join_stream(
    group_ids: str,
    phone_number: str,
    token: str = ""
):
    """
    SSE Streaming Bulk Join – emits real-time progress events.
    Uses token query param instead of Authorization header (EventSource limitation).
    group_ids: JSON-encoded list of group IDs.
    """
    import json as _json
    from jose import JWTError, jwt as _jwt  # type: ignore
    SECRET_KEY_LOCAL = os.getenv("JWT_SECRET", "super-secret-key-change-this-in-production")
    
    # Manually validate the token (can't use Depends for SSE endpoints)
    user_id = None
    try:
        payload = _jwt.decode(token, SECRET_KEY_LOCAL, algorithms=["HS256"])
        user_id = payload.get("sub")
    except Exception:
        pass
    
    if not user_id:
        async def unauth_stream():
            yield f"data: {_json.dumps({'type': 'error', 'msg': 'Unauthorized'})}\n\n"
        return StreamingResponse(unauth_stream(), media_type="text/event-stream")
    
    try:
        ids = _json.loads(group_ids)
    except Exception:
        ids = [group_ids]

    conn = get_db_connection()
    row = conn.execute(
        "SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?",
        (phone_number, user_id)
    ).fetchone()
    if hasattr(conn, "close"): conn.close()
    
    if not row:
        async def error_stream():
            yield f"data: {_json.dumps({'type': 'error', 'msg': 'Account not found'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    session_str, api_id_val, api_hash_val = row[0], int(row[1]), row[2]
    total = len(ids)

    async def event_generator():
        try:
            client = await POOL.get_client(user_id, phone_number) # type: ignore
            
            joined: int = 0
            failed: int = 0
            failed_groups = []
            
            yield f"data: {_json.dumps({'type': 'start', 'total': total})}\n\n"
            
            for idx, g_id in enumerate(ids, start=1):
                group_label = str(g_id)
                try:
                    # Optimized Human Speed (15-35s)
                    wait_time = random.randint(15, 35)
                    yield f"data: {_json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'msg': f'Safety delay {wait_time}s...'})}\n\n"
                    await asyncio.sleep(wait_time)
                    
                    yield f"data: {_json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'msg': f'Joining {group_label}...'})}\n\n"
                    # Use pool-based client
                    await smart_join(client, g_id)
                    
                    joined = joined + 1
                    yield f"data: {_json.dumps({'type': 'joined', 'name': group_label, 'idx': idx, 'total': total, 'joined': joined, 'failed': failed})}\n\n"
                except Exception as e:
                    failed = failed + 1
                    err_r = str(e)
                    err_s = err_r
                    # Extremely safe truncation to avoid indexing errors
                    if len(err_r) > 80:
                        err_s = ""
                        for i, char in enumerate(err_r):
                            if i >= 77: break
                            err_s += char
                        err_s += "..."
                    failed_groups.append({'name': group_label, 'reason': err_s})
                    yield f"data: {_json.dumps({'type': 'failed', 'name': group_label, 'reason': err_s, 'idx': idx, 'total': total, 'joined': joined, 'failed': failed})}\n\n"
                    if "FloodWaitError" in err_r:
                        yield f"data: {_json.dumps({'type': 'flood', 'msg': 'Flood detected. Stopping to protect your account.'})}\n\n"
                        break
            
            yield f"data: {_json.dumps({'type': 'done', 'joined': joined, 'failed': failed, 'failed_groups': failed_groups})}\n\n"
        except Exception as global_e:
            yield f"data: {_json.dumps({'type': 'error', 'msg': f'Stream error: {str(global_e)}'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

class JoinRequest(BaseModel):
    group_id: str
    phone_number: str

@app.post("/api/telegram/join")
async def join_single(req: JoinRequest, user_id: str = Depends(get_current_user_id)):
    try:
        client = await POOL.get_client(user_id, req.phone_number)
        await smart_join(client, req.group_id)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/telegram/extract")
async def extract_group_members(req: JoinRequest, user_id: str = Depends(get_current_user_id)):
    """Fetches members from a group and returns them to UI for manual selection."""
    try:
        client = await POOL.get_client(user_id, req.phone_number)
        
        # Resolve entity
        try:
            entity = await client.get_entity(req.group_id)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not resolve group: {str(e)}")

        members = []
        try:
            async for user in client.iter_participants(entity, limit=500):
                if user.bot: continue
                members.append({
                    "id": str(user.id),
                    "username": user.username,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "phone": getattr(user, 'phone', None),
                    "is_bot": user.bot
                })
        except Exception as e:
            log_debug(f"Extraction restricted or failed for {req.group_id}: {str(e)}")
            raise HTTPException(status_code=403, detail="Member list restricted by admins or group privacy.")

        return {"status": "success", "count": len(members), "members": members}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class MemberSaveRequest(BaseModel):
    id: str
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    group_id: Optional[str] = None

@app.post("/api/telegram/leads/members/bulk-save")
async def bulk_save_members(req_list: List[MemberSaveRequest], user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    try:
        for m in req_list:
            conn.execute(
                """INSERT INTO lead_members (user_id, group_id, tg_id, username, first_name, last_name, phone)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user_id, m.group_id, m.id, m.username, m.first_name, m.last_name, m.phone)
            )
        if hasattr(conn, "commit"): conn.commit()
        return {"status": "success", "count": len(req_list)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if hasattr(conn, "close"): conn.close()

@app.get("/api/telegram/leads/members")
async def get_saved_members(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM lead_members WHERE user_id = ? ORDER BY scraped_at DESC", (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    return {
        "members": [
            {
                "id": r["id"],
                "group_id": r["group_id"],
                "username": r["username"],
                "first_name": r["first_name"],
                "last_name": r["last_name"],
                "phone": r["phone"],
                "scraped_at": r["scraped_at"]
            } for r in rows
        ]
    }

@app.delete("/api/telegram/leads/members/{member_id}")
async def delete_saved_member(member_id: int, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    conn.execute("DELETE FROM lead_members WHERE id = ? AND user_id = ?", (member_id, user_id))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

@app.get("/api/broadcasts")
async def get_active_broadcasts():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM broadcasts WHERE is_active = 1 ORDER BY created_at DESC").fetchall()
    if hasattr(conn, "close"): conn.close()
    return {"broadcasts": [dict(id=r["id"], message=r["message"], type=r["type"], created_at=r["created_at"]) for r in rows]}

@app.post("/api/admin/broadcast")
async def create_broadcast(message: str, type: str = 'info', admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    conn.execute("INSERT INTO broadcasts (message, type) VALUES (?, ?)", (message, type))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

@app.delete("/api/admin/broadcast/{broadcast_id}")
async def delete_broadcast(broadcast_id: int, admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    conn.execute("DELETE FROM broadcasts WHERE id = ?", (broadcast_id,))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

class SaveGroupRequest(BaseModel):
    id: str
    title: str
    username: Optional[str] = None
    participants_count: int = 0
    type: str
    is_private: bool = False
    country: str = "Global"
    user_shows: int = 1
    global_shows: int = 1
    source: str = "manual"

@app.post("/api/telegram/leads/groups/bulk-save")
async def bulk_save_groups(groups: List[SaveGroupRequest], user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    for g in groups:
        conn.execute(
            """INSERT OR REPLACE INTO scraped_groups 
               (id, user_id, title, username, participants_count, type, is_private, country, user_shows, global_shows, source) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (g.id, user_id, g.title, g.username, g.participants_count, g.type, 1 if g.is_private else 0, g.country, g.user_shows, g.global_shows, g.source)
        )
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success", "count": len(groups)}

@app.get("/api/telegram/leads/groups")
async def get_saved_groups(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM scraped_groups WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    
    return {
        "groups": [
            {
                "id": r["id"],
                "title": r["title"],
                "username": r["username"],
                "participants_count": r["participants_count"],
                "type": r["type"],
                "is_private": bool(r["is_private"]),
                "country": r["country"],
                "user_shows": r["user_shows"],
                "global_shows": r["global_shows"],
                "source": r["source"],
                "created_at": r["created_at"]
            } for r in rows
        ]
    }

@app.delete("/api/telegram/leads/groups/{group_id}")
async def delete_saved_group(group_id: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    conn.execute("DELETE FROM scraped_groups WHERE id = ? AND user_id = ?", (group_id, user_id))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

@app.delete("/api/telegram/campaigns/{task_id}")
async def delete_campaign(task_id: int, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    row = conn.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id)).fetchone()
    if not row:
        if hasattr(conn, "close"): conn.close()
        raise HTTPException(status_code=404, detail="Campaign not found")
        
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success", "message": "Campaign deleted successfully"}

class CampaignEditRequest(BaseModel):
    name: Optional[str] = None
    message_text: Optional[str] = None
    scheduled_time: Optional[str] = None
    target_groups: Optional[List[str]] = None
    interval_hours: Optional[int] = None

@app.put("/api/telegram/campaigns/{task_id}")
async def edit_campaign(task_id: int, req: CampaignEditRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    task = conn.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id)).fetchone()
    if not task:
        if hasattr(conn, "close"): conn.close()
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    updates = []
    params: List[Any] = []
    if req.name is not None:
        updates.append("name = ?")
        params.append(req.name)
    if req.message_text is not None:
        updates.append("message_text = ?")
        params.append(req.message_text)
    if req.scheduled_time is not None:
        updates.append("scheduled_time = ?")
        params.append(req.scheduled_time)
    if req.target_groups is not None:
        updates.append("target_groups = ?")
        params.append(json.dumps(req.target_groups))
    if req.interval_hours is not None:
        updates.append("interval_hours = ?")
        params.append(req.interval_hours)
    
    if updates:
        params.append(task_id)
        params.append(user_id)
        conn.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ? AND user_id = ?", tuple(params))
        if hasattr(conn, "commit"): conn.commit()
    
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}


class ExtractRequest(BaseModel):
    group_id: str
    phone_number: str

@app.post("/api/telegram/extract")
async def extract_members(req: ExtractRequest, user_id: str = Depends(get_current_user_id)):
    try:
        client = await POOL.get_client(user_id, req.phone_number)
        
        # Resolve entity
        target = req.group_id
        if str(target).lstrip('-').isdigit(): target = int(target)
        entity = await client.get_entity(target)
        
        # Get participants
        users = await client.get_participants(entity, limit=1000)
        
        participants = []
        for u in users:
            if u.username or getattr(u, 'phone', None):
                participants.append({
                    "id": str(u.id),
                    "username": str(u.username or ''),
                    "first_name": str(u.first_name or ''),
                    "last_name": str(u.last_name or '')
                })
            
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
        log_debug(f"EXTRACT_ERROR for {req.phone_number}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Extraction failed: {str(e)}")

@app.get("/api/telegram/leads/members")
async def get_member_leads(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM leads WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    return {"members": [
        dict(id=r[0], user_id=r[1], group_id=r[2], username=r[3], first_name=r[4], last_name=r[5], created_at=r[6]) 
        for r in rows
    ]}

@app.delete("/api/telegram/leads/members/{member_id}")
async def delete_member_lead(member_id: int, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    conn.execute("DELETE FROM leads WHERE id = ? AND user_id = ?", (member_id, user_id))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

class BulkDeleteRequest(BaseModel):
    ids: List[Union[str, int]]

@app.post("/api/telegram/leads/groups/bulk-delete")
async def bulk_delete_groups(req: BulkDeleteRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    placeholders = ', '.join(['?'] * len(req.ids))
    conn.execute(f"DELETE FROM scraped_groups WHERE user_id = ? AND id IN ({placeholders})", (user_id, *req.ids))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

@app.post("/api/telegram/leads/members/bulk-delete")
async def bulk_delete_members(req: BulkDeleteRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    placeholders = ', '.join(['?'] * len(req.ids))
    conn.execute(f"DELETE FROM leads WHERE user_id = ? AND id IN ({placeholders})", (user_id, *req.ids))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}



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
            dict(id=t[0], phone_number=t[1], scheduled_time=t[2], message=t[3], groups=t[4], status=t[5]) 
            for t in tasks
        ]
    }

@app.post("/api/telegram/campaigns")
async def create_campaign(req: CampaignRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    try:
        # The schedule_time sent by the frontend must already be in UTC.
        # Frontend converts datetime-local (local time) -> UTC before sending.
        # We store it as-is and the poller compares against datetime.now(timezone.utc).
        now_utc = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M')
        print(f"CAMPAIGN: New campaign '{req.name}' | Scheduled(UTC): {req.schedule_time} | Server UTC now: {now_utc}")
        conn.execute(
            "INSERT INTO tasks (user_id, name, phone_number, scheduled_time, message_text, target_groups, status, interval_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, req.name, req.phone_number, req.schedule_time, req.message, str(req.groups), "pending", req.interval_hours)
        )
        if hasattr(conn, "commit"): conn.commit()
        return {"status": "success", "message": f"Campaign scheduled for {req.schedule_time} UTC."}
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

@app.post("/api/admin/maintenance/clear-leads")
async def clear_leads(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    
    # Thoroughly wipe all lead-related data
    conn.execute("DELETE FROM leads")
    conn.execute("DELETE FROM scraped_groups")
    conn.execute("DELETE FROM lead_members")
    conn.execute("DELETE FROM scrape_history")
    
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success", "message": "All database lead intelligence has been purged."}

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
    
    # System Resource Metrics
    pool_active = len(POOL._clients)
    
    # Active broadcasts
    broadcasts = conn.execute("SELECT * FROM broadcasts ORDER BY created_at DESC").fetchall()
    
    if hasattr(conn, "close"): conn.close()
    
    return {
        "global": {
            "users": total_users,
            "accounts": total_accounts,
            "tasks": total_tasks,
            "leads": total_leads
        },
        "broadcasts": [dict(id=b["id"], message=b["message"], type=b["type"], created_at=b["created_at"]) for b in broadcasts],
        "per_user": [dict(id=s[0], username=s[1], is_active=bool(s[2]), accounts=s[3], tasks=s[4], leads=s[5]) for s in user_stats],
        "service_health": {
             "database": "Healthy",
             "poller": "Active",
             "api": "Operational",
             "pool_active_nodes": pool_active
        }
    }

@app.delete("/api/admin/users/{user_id}/leads")
async def admin_clear_user_leads(user_id: str, admin_id: str = Depends(get_current_admin)):
    """Deletes all leads and scraped history for a specific user."""
    conn = get_db_connection()
    try:
        # Delete from leads table
        conn.execute("DELETE FROM leads WHERE user_id = ?", (user_id,))
        # Delete from scraped_groups table
        conn.execute("DELETE FROM scraped_groups WHERE user_id = ?", (user_id,))
        # Delete from scrape_history
        conn.execute("DELETE FROM scrape_history WHERE user_id = ?", (user_id,))
        
        if hasattr(conn, "commit"): conn.commit()
        log_debug(f"ADMIN: All leads cleared for user {user_id}")
        return {"status": "success", "message": f"All leads for user {user_id} have been purged."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if hasattr(conn, "close"): conn.close()

@app.post("/api/admin/maintenance/clear-leads")
async def admin_clear_all_leads(admin_id: str = Depends(get_current_admin)):
    """Wipes the entire leads and scraped_groups tables for all users."""
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM leads")
        conn.execute("DELETE FROM scraped_groups")
        conn.execute("DELETE FROM scrape_history")
        try: conn.execute("VACUUM")
        except: pass
        if hasattr(conn, "commit"): conn.commit()
        log_debug("ADMIN: GLOBAL PURGE - All Leads Data wiped.")
        return {"status": "success", "message": "Global leads database has been completely purged."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if hasattr(conn, "close"): conn.close()

@app.post("/api/admin/maintenance/clear-tasks")
async def admin_clear_task_history(admin_id: str = Depends(get_current_admin)):
    """Wipes historical task data (completed/failed/cancelled)."""
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM tasks WHERE status IN ('completed', 'failed', 'cancelled')")
        if hasattr(conn, "commit"): conn.commit()
        log_debug("ADMIN: GLOBAL PURGE - Task History purged.")
        return {"status": "success", "message": "Historical task data has been removed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if hasattr(conn, "close"): conn.close()

@app.get("/api/dashboard/stats")
async def get_dashboard_stats(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    try:
        if user_id == "admin_virtual_id":
            # Global counts for Admin
            total_accounts = conn.execute("SELECT COUNT(*) FROM accounts WHERE status = 'active'").fetchone()[0]
            c_scraped = conn.execute("SELECT COUNT(*) FROM scraped_groups").fetchone()[0]
            c_members = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
            total_leads = c_scraped + c_members
            pending_tasks = conn.execute("SELECT COUNT(*) FROM tasks WHERE status = 'pending'").fetchone()[0]
            messages_sent = conn.execute("SELECT COUNT(*) FROM tasks WHERE status = 'completed'").fetchone()[0]
            
            tasks_rows = conn.execute(
                "SELECT phone_number, status, message_text, scheduled_time FROM tasks ORDER BY scheduled_time DESC LIMIT 5"
            ).fetchall()
            
            trends = []
            for i in range(6, -1, -1):
                day = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
                count = conn.execute(
                    "SELECT COUNT(*) FROM tasks WHERE status = 'completed' AND scheduled_time LIKE ?",
                    (f"{day}%",)
                ).fetchone()[0]
                trends.append(count)
        else:
            # Core counts for regular user
            total_accounts = conn.execute("SELECT COUNT(*) FROM accounts WHERE user_id = ? AND status = 'active'", (user_id,)).fetchone()[0]
            
            # Dashboard leads should strictly match what the user sees in the Leads page
            total_leads = conn.execute("SELECT COUNT(*) FROM leads WHERE user_id = ?", (user_id,)).fetchone()[0]
            
            pending_tasks = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'pending'", (user_id,)).fetchone()[0]
            messages_sent = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completed'", (user_id,)).fetchone()[0]
            
            tasks_rows = conn.execute(
                "SELECT phone_number, status, message_text, scheduled_time FROM tasks WHERE user_id = ? ORDER BY scheduled_time DESC LIMIT 5", 
                (user_id,)
            ).fetchall()
            
            trends = []
            for i in range(6, -1, -1):
                day = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
                count = conn.execute(
                    "SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completed' AND scheduled_time LIKE ?",
                    (user_id, f"{day}%")
                ).fetchone()[0]
                trends.append(count)
            
        service_health = {
             "database": "Online",
             "poller": "Active" if pending_tasks >= 0 else "Degraded",
             "api": "Operational" if total_accounts > 0 else "Idle"
        }

        return {
            "counts": {
                "messages": messages_sent,
                "accounts": total_accounts,
                "leads": total_leads,
                "pending": pending_tasks
            },
            "recent_tasks": [
                {
                    "account": t[0],
                    "status": t[1],
                    "message": t[2],
                    "time": t[3]
                } for t in tasks_rows
            ],
            "engagement_flow": trends,
            "service_health": service_health
        }
    except Exception as e:
        print(f"Stats error: {e}")
        return {
             "counts": {"accounts": 0, "leads": 0, "pending": 0, "messages": 0}, 
             "recent_tasks": [],
             "engagement_flow": [0]*10,
             "service_health": {"database": "Error", "poller": "Error", "api": "Error"}
        }
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
async def root():
    return {"status": "ok", "message": "Telegram Automation API is running"}

async def task_poller():
    active_tasks = set()

    async def run_single_task(task_id, message, groups_str, phone_num, u_id, interval, scheduled_time):
        try:
            # Update status to 'processing'
            conn = get_db_connection()
            conn.execute("UPDATE tasks SET status = 'processing' WHERE id = ?", (task_id,))
            if hasattr(conn, "commit"): conn.commit()
            
            try:
                client = await POOL.get_client(u_id, phone_num)
            except Exception as e:
                print(f"BKG: Pool error for task {task_id}: {e}")
                conn = get_db_connection()
                conn.execute("UPDATE tasks SET status = 'failed' WHERE id = ?", (task_id,))
                if hasattr(conn, "commit"): conn.commit()
                if hasattr(conn, "close"): conn.close()
                return
            
            # Identity Verification
            me = await client.get_me()
            me_fn = getattr(me, 'first_name', '') or ''
            me_ln = getattr(me, 'last_name', '') or ''
            me_un = getattr(me, 'username', '') or ''
            me_id = getattr(me, 'id', '0')
            sender_name = f"{me_fn} {me_ln}".strip() or me_un or "Unknown"
            print(f"BKG_TASK[{task_id}]: Authenticated as '{sender_name}' (ID: {me_id})")
            
            try:
                target_groups = ast.literal_eval(groups_str)
            except:
                target_groups = [groups_str] if groups_str else []

            def recursive_spin(text: str) -> str:
                text_obj = str(text)
                while '{' in text_obj and '}' in text_obj:
                    # Simple regex for leaf-level spintax: {a|b|c}
                    text_obj = re.sub(r'\{([^{}]*)\}', lambda m: random.choice(m.group(1).split('|')), text_obj)
                return str(text_obj)

            # High Fidelity Extraction Loop
            for raw_group in target_groups:
                try:
                    # Clean and resolve ID format (int vs str)
                    group = str(raw_group).strip()
                    if not group: continue
                    
                    target_id = group
                    if group.lstrip('-').isdigit():
                        target_id = int(group)

                    await asyncio.sleep(random.uniform(3.0, 7.0)) # Safety delay
                    
                    # Resolve Target Entity
                    try:
                        entity = await client.get_entity(target_id)
                        res_title = getattr(entity, 'title', str(target_id))
                        log_debug(f"BKG_TASK[{task_id}]: Target resolved -> {res_title}")
                    except Exception as e:
                        log_debug(f"BKG_TASK[{task_id}]: Mapping Error for {group}: {str(e)}")
                        continue

                    # High-Fidelity Authorization Check
                    if not await client.is_user_authorized():
                        log_debug(f"BKG_TASK[{task_id}]: CRITICAL - Session expired for {phone_num}")
                        # Mark failed and exit since we can't send anything
                        conn = get_db_connection()
                        conn.execute("UPDATE tasks SET status = 'failed' WHERE id = ?", (task_id,))
                        if hasattr(conn, "commit"): conn.commit()
                        if hasattr(conn, "close"): conn.close()
                        await client.disconnect()
                        active_tasks.remove(task_id)
                        return

                    # Personalization Merging
                    final_msg_base = str(message)
                    final_msg_base = final_msg_base.replace('{{Group Name}}', getattr(entity, 'title', 'Our Group'))
                    final_msg_base = final_msg_base.replace('{{First Name}}', '').replace('{{Username}}', '')

                    # Final Spintax processing
                    final_msg = recursive_spin(final_msg_base)
                    
                    # Forensic Snapshot
                    msg_snapshot = str(final_msg)
                    if len(msg_snapshot) > 50:
                        msg_p = ""
                        for i, char in enumerate(msg_snapshot):
                            if i >= 47: break
                            msg_p += char
                        msg_snapshot = msg_p + "..."
                        
                    log_debug(f"BKG_TASK[{task_id}]: Sending to {target_id} via {sender_name}...")
                    log_debug(f"BKG_TASK[{task_id}]: Content Snapshot: {msg_snapshot}")
                    
                    try:
                        await client.send_message(entity, final_msg)
                        log_debug(f"BKG_TASK[{task_id}]: TRANSMITTED successfully.")
                    except Exception as send_e:
                        log_debug(f"BKG_TASK[{task_id}]: SEND ERROR to {target_id}: {str(send_e)}")
                    
                    # Moderate Anti-Spam Interval
                    await asyncio.sleep(random.randint(15, 30))
                except Exception as group_err:
                    log_debug(f"BKG_TASK[{task_id}]: Loop error on group {raw_group}: {str(group_err)}")
                    if "FloodWaitError" in str(group_err): 
                        log_debug(f"BKG_TASK[{task_id}]: Flood detected. Aborting sequence.")
                        break
            
            # Pooled clients are not disconnected manually here
            # Mark completed OR Re-schedule
            conn = get_db_connection()
            if interval > 0:
                new_time = (datetime.now(timezone.utc) + timedelta(hours=interval)).isoformat()
                conn.execute("UPDATE tasks SET status = 'pending', scheduled_time = ? WHERE id = ?", (new_time, task_id))
                print(f"BKG: Task {task_id} rescheduled for {new_time}")
            else:
                conn.execute("UPDATE tasks SET status = 'completed' WHERE id = ?", (task_id,))
                print(f"BKG: Task {task_id} marked COMPLETED")
            
            if hasattr(conn, "commit"): conn.commit()
            if hasattr(conn, "close"): conn.close()

        except Exception as e:
            print(f"BKG: Task {task_id} FATAL error: {e}")
            conn = get_db_connection()
            conn.execute("UPDATE tasks SET status = 'failed' WHERE id = ?", (task_id,))
            if hasattr(conn, "commit"): conn.commit()
            if hasattr(conn, "close"): conn.close()
        finally:
            active_tasks.remove(task_id)

    while True:
        try:
            conn = get_db_connection()
            now_dt = datetime.now(timezone.utc)
            now_str = now_dt.strftime('%Y-%m-%dT%H:%M')
            
            tasks = conn.execute(
                "SELECT id, message_text, target_groups, phone_number, user_id, interval_hours, scheduled_time FROM tasks WHERE status = 'pending' AND scheduled_time <= ?", 
                (now_str,)
            ).fetchall()
            
            # Heartbeat log
            print(f"POLLER: Heartbeat - {now_str} | Pending tasks found: {len(tasks)}")
            
            if hasattr(conn, "close"): conn.close()
            
            # Launch loop
            for t in tasks:
                task_id = t[0]
                task_time = t[6]
                if task_id not in active_tasks:
                    active_tasks.add(task_id)
                    # Start task in background
                    asyncio.create_task(run_single_task(*t))
                    print(f"POLLER: Launched task {task_id} scheduled for {task_time} (Server now: {now_str})")
                else:
                    # Log if it's already running to avoid confusion
                    print(f"POLLER: Task {task_id} is already in execution set. Skipping launch.")
            
        except Exception as e:
            print(f"BKG: Poller major error: {e}")
        
        await asyncio.sleep(30) # Poll every 30 seconds

    print("CORE: System Ready.")

if __name__ == "__main__":
    import uvicorn  # type: ignore
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
