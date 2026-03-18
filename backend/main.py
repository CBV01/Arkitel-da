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
from telethon.tl.types import ChannelParticipantsSearch, InputMessagesFilterEmpty, InputPeerEmpty, InputPeerChannel, InputPeerChat, User # type: ignore
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

# --- Tiered Plan Configurations (Dynamic from DB) ---
def get_plan_configs() -> Dict[str, Dict[str, Any]]:
    configs: Dict[str, Dict[str, Any]] = {
        "free": {"max_daily_campaigns": 20, "max_accounts": 1, "max_daily_keywords": 5, "scrape_limit": 50, "max_templates": 1, "has_premium_access": False},
        "unlimited": {"max_daily_campaigns": 999999, "max_accounts": 99, "max_daily_keywords": 999999, "scrape_limit": 1000, "max_templates": 999, "has_premium_access": True}
    }
    conn = None
    try:
        conn = get_db_connection()
        rows = conn.execute("SELECT * FROM plans").fetchall()
        for r in rows:
            configs[r["key"]] = {
                "name": r["name"],
                "price": r["price"],
                "max_daily_campaigns": r["max_daily_campaigns"],
                "max_accounts": r["max_accounts"],
                "max_daily_keywords": r["max_daily_keywords"],
                "scrape_limit": r["scrape_limit"],
                "max_templates": r["max_templates"],
                "has_premium_access": bool(r["has_premium_access"]),
                "perks": json.loads(r["perks"]) if r["perks"] else []
            }
    except Exception as e:
        print(f"Error loading plan configs: {e}")
    finally:
        if conn and hasattr(conn, "close"): 
            conn.close()
    
    return configs

PLAN_CONFIGS: Dict[str, Dict[str, Any]] = get_plan_configs() # Initial load

def check_and_reset_daily_limits(conn, user_id, user_row):
    """Resets daily counts if the day has changed."""
    last_reset = user_row["last_reset_date"]
    now_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    if last_reset != now_date:
        conn.execute(
            "UPDATE users SET daily_campaign_count = 0, daily_keyword_count = 0, last_reset_date = ? WHERE id = ?",
            (now_date, user_id)
        )
        if hasattr(conn, "commit"): conn.commit()
        return True
    
    # Subscription Expiry Check
    expiry_date_str = user_row["plan_expires_at"]
    if expiry_date_str and user_row["plan"] != "free":
        try:
            # Format: 2024-03-24T12:00
            expiry_dt = datetime.fromisoformat(expiry_date_str.replace('Z', ''))
            if datetime.now() > expiry_dt:
                log_debug(f"SUBSCRIPTION: Plan expired for {user_id}. Resetting to Free.")
                conn.execute(
                    "UPDATE users SET plan = 'free', plan_expires_at = NULL, is_approved = 0 WHERE id = ?",
                    (user_id,)
                )
                if hasattr(conn, "commit"): conn.commit()
                return True
        except:
            pass

    return False

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    print("CORE: Initializing Database Schema...")
    try:
        from database import init_db  # type: ignore
        init_db()
        print("CORE: Database Schema Initialized.")
        
        # Cleanup stuck tasks
        conn = get_db_connection()
        conn.execute("UPDATE tasks SET status = 'pending' WHERE status = 'processing'")
        if hasattr(conn, "commit"): conn.commit()
        if hasattr(conn, "close"): conn.close()
        print("CORE: Stuck tasks reset to pending.")
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

async def verify_telegram_info(username: str) -> Dict[str, Any]:
    """
    Checks t.me/username anonymously to see if it exists and get member count.
    Used to filter out dead or non-existent scraping results.
    """
    if not username: return {"exists": False, "participants_count": 0}
    clean_user = username.replace('@', '').strip()
    if not clean_user: return {"exists": False, "participants_count": 0}

    # Safety check for BeautifulSoup availability
    if not BS4_AVAILABLE:
        return {"exists": True, "participants_count": 0} # Assume exists if we can't verify

    url = f"https://t.me/{clean_user}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                return {"exists": False, "participants_count": 0}
            
            soup = BeautifulSoup(resp.text, 'html.parser')
            title_elem = soup.find("div", class_="tgme_page_title")
            
            # If there's no title element, it's usually a "Contact @username" placeholder for a dead/non-existent account
            if not title_elem:
                return {"exists": False, "participants_count": 0}
            
            extra_elem = soup.find("div", class_="tgme_page_extra")
            members = 0
            if extra_elem:
                text = extra_elem.get_text()
                # Matches "1 234 members" or "10,000 subscribers"
                m = re.search(r'([\d\s,]+)\s*(subscribers|members|online)', text, re.IGNORECASE)
                if m:
                    members = int(re.sub(r'\D', '', m.group(1)))
            
            return {
                "exists": True, 
                "participants_count": members, 
                "title": title_elem.get_text(strip=True)
            }
    except:
        # Fallback to assuming it exists if the check itself fails (e.g. network error)
        return {"exists": True, "participants_count": 0}
    
    # Final default return for safety
    return {"exists": True, "participants_count": 0}



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
    """Smarter handle resolver for Telegram joining & Campaigns."""
    try:
        # 1. Try resolving directly (ID or Username)
        resolved_id = target
        target_str = str(target).strip()
        
        if target_str.lstrip('-').isdigit():
            resolved_id = int(target_str)
            
        # Optional: DB lookup by ID to find username (much more stable)
        try:
            conn = get_db_connection()
            # Try exact ID match first
            row = conn.execute("SELECT username FROM scraped_groups WHERE id = ?", (target_str,)).fetchone()
            if not row:
                # Try with -100 prefix variations
                if target_str.isdigit():
                    row = conn.execute("SELECT username FROM scraped_groups WHERE id = ?", (f"-100{target_str}",)).fetchone()
                elif target_str.startswith("-100"):
                    # Use replace to avoid index errors in some linters
                    clean_id = target_str.replace("-100", "", 1)
                    row = conn.execute("SELECT username FROM scraped_groups WHERE id = ?", (clean_id,)).fetchone()
            
            if row and row[0]:
                resolved_id = row[0]
            if hasattr(conn, "close"): conn.close()
        except: pass

        try:
            entity = await client.get_entity(resolved_id)
            # If we got a User object but asked for a positive int, it's likely a channel missing the -100 prefix.
            if isinstance(entity, User) and isinstance(resolved_id, int) and resolved_id > 0:
                raise ValueError("Resolved to User, but likely meant a Channel/Group. Forcing -100 prefix check.")
            return entity
        except Exception as e:
            # If it's a positive number, try adding -100 prefix (common for Channels/Supergroups)
            if isinstance(resolved_id, int) and resolved_id > 0:
                try:
                    alt_id = int(f"-100{resolved_id}")
                    entity = await client.get_entity(alt_id)
                    return entity
                except: pass
            pass

        # 2. Try cleaning username
        if target_str.startswith('@') or not target_str.replace('-','').isdigit():
            username = target_str.replace('@', '', 1)
            try:
                entity = await client.get_entity(username)
                return entity
            except: pass
        
        # 3. Try resolving as invite link
        if "t.me/" in target_str:
            if "joinchat/" in target_str or "t.me/+" in target_str:
                hash_val = target_str.split('/')[-1].replace('+', '')
                return ("invite", hash_val)
            else:
                username = target_str.split('/')[-1]
                try:
                    entity = await client.get_entity(username)
                    return entity
                except: pass

        # 4. Final Hail Mary: Search for it globally to "prime" the session
        try:
            from telethon.tl.functions.contacts import SearchRequest # type: ignore
            await client(SearchRequest(q=target_str, limit=5))
            entity = await client.get_entity(target_str)
            return entity
        except: pass

    except Exception as gl_e:
        log_debug(f"RESOLVE_GL_ERR for {target}: {str(gl_e)}")

    return None

async def smart_join(client, target, user_id: str, phone_number: str):
    """Joins a group/channel and records it in the persistence layer."""
    from telethon.tl.functions.channels import JoinChannelRequest # type: ignore
    from telethon.tl.functions.messages import ImportChatInviteRequest # type: ignore
    
    res = await resolve_tg_entity(client, target)
    if not res:
        raise Exception(f"Could not resolve entity for {target}")
        
    if isinstance(res, User):
        raise Exception(f"Target '{target}' resolved to a User entity. You cannot join a User.")
        
    if isinstance(res, tuple) and res[0] == "invite":
        result = await client(ImportChatInviteRequest(res[1]))
        target_id = str(target) # For invite links, we use the link as ID or the hash
    else:
        result = await client(JoinChannelRequest(res))
        target_id = str(getattr(res, 'id', target))

    # Record Persistence (Multi-mapping for robust UI matching)
    try:
        conn = get_db_connection()
        # 1. Record the exact identifier used for the join request (e.g. @username or numeric ID)
        conn.execute(
            "INSERT OR IGNORE INTO account_joins (user_id, phone_number, group_id) VALUES (?, ?, ?)",
            (user_id, phone_number, str(target))
        )
        if not isinstance(res, tuple):
            # 2. Record the resolved numeric ID (The most stable reference)
            res_id = str(getattr(res, 'id', ''))
            if res_id:
                conn.execute(
                    "INSERT OR IGNORE INTO account_joins (user_id, phone_number, group_id) VALUES (?, ?, ?)",
                    (user_id, phone_number, res_id)
                )
            # 3. Record the username if it exists
            username = getattr(res, 'username', None)
            if username:
                conn.execute(
                    "INSERT OR IGNORE INTO account_joins (user_id, phone_number, group_id) VALUES (?, ?, ?)",
                    (user_id, phone_number, str(username))
                )
        if hasattr(conn, "commit"): conn.commit()
        if hasattr(conn, "close"): conn.close()
    except Exception as db_e:
        log_debug(f"DB_JOIN_REC_ERR: {str(db_e)}")

    return result

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
        # Key: phone_number (Each account has exactly one session regardless of who uses it)
        self._clients: Dict[str, TelegramClient] = {}
        self._locks: Dict[str, asyncio.Lock] = {}

    async def get_client(self, user_id: str, phone_number: str) -> TelegramClient:
        # 1. Resolve ownership first to prevent duplicate sessions
        conn = get_db_connection()
        try:
            if user_id == "admin_virtual_id":
                row = conn.execute(
                    "SELECT session_string, api_id, api_hash, user_id FROM accounts WHERE phone_number = ?", 
                    (phone_number,)
                ).fetchone()
            else:
                # If a regular user tries to grab an account, check if it's theirs OR if it belongs to admin globally
                row = conn.execute(
                    "SELECT session_string, api_id, api_hash, user_id FROM accounts WHERE phone_number = ? AND (user_id = ? OR user_id = 'admin_virtual_id')", 
                    (phone_number, user_id)
                ).fetchone()
            
            if not row:
                print(f"POOL_ERROR: Account {phone_number} not found for user {user_id}")
                raise HTTPException(status_code=404, detail="Account not found.")
                
            session_str, api_id, api_hash, owner_id = row[0], int(row[1]), row[2], row[3]
        finally:
            if hasattr(conn, "close"): conn.close()

        # Session-unique key (Phone number is the unique axis)
        session_key = phone_number
        
        if session_key not in self._locks:
            self._locks[session_key] = asyncio.Lock()
            
        async with self._locks[session_key]:
            # Use a separate key type for cache to avoid tuple confusion
            # We map the session object to the phone number
            if session_key in self._clients:
                client = self._clients[session_key]
                if client.is_connected():
                    try:
                        await client.get_me() 
                        return client
                    except Exception:
                        print(f"POOL: Node {phone_number} stale. Disconnecting...")
                        try: await client.disconnect()
                        except: pass
                
            log_debug(f"POOL: Deploying persistent kernel for {phone_number} (Owner: {owner_id})")
            new_client = TelegramClient(StringSession(session_str), api_id, api_hash)
            await new_client.connect()
            
            if not await new_client.is_user_authorized():
                await new_client.disconnect()
                # Update DB status
                conn = get_db_connection()
                conn.execute("UPDATE accounts SET status = 'expired', status_detail = 'Auth token invalid' WHERE phone_number = ?", (phone_number,))
                if hasattr(conn, "commit"): conn.commit()
                if hasattr(conn, "close"): conn.close()
                raise HTTPException(status_code=401, detail=f"Session for {phone_number} has expired.")
                
            # Success check & Mark active
            try:
                me = await new_client.get_me()
                log_debug(f"POOL: Node {phone_number} ( @{getattr(me,'username','?')} ) online.")
            except: pass
            
            conn = get_db_connection()
            conn.execute("UPDATE accounts SET status = 'active' WHERE phone_number = ?", (phone_number,))
            if hasattr(conn, "commit"): conn.commit()
            if hasattr(conn, "close"): conn.close()
            
            self._clients[session_key] = new_client
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
    email: Optional[str] = None

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
    exclude_groups: list[str] = []
    interval_hours: int = 0
    interval_minutes: int = 0

class AdminLoginRequest(BaseModel):
    password: str

class TemplateRequest(BaseModel):
    name: str
    content: str

class PermanentExcludeRequest(BaseModel):
    ids: list[str]

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
        "INSERT INTO users (id, username, password_hash, role, email) VALUES (?, ?, ?, ?, ?)",
        (user_id, user.username, pw_hash, "user", user.email)
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
            "id": "admin_virtual_id",
            "username": "System Administrator",
            "role": "admin",
            "plan": "unlimited",
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
    # Limit check
    conn = get_db_connection()
    user = conn.execute("SELECT max_accounts, plan FROM users WHERE id = ?", (user_id,)).fetchone()
    count_row = conn.execute("SELECT COUNT(*) FROM accounts WHERE user_id = ?", (user_id,)).fetchone()
    if hasattr(conn, "close"): conn.close()
    
    plan = (user["plan"] if user else "free") or "free"
    plan_cfg = PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])
    
    # Use user-specific override or fallback to plan default
    max_acc = user["max_accounts"] if user and user["max_accounts"] is not None else plan_cfg["max_accounts"]
    current_count = count_row[0] if count_row else 0
    
    if user_id != "admin_virtual_id" and plan != "unlimited" and current_count >= max_acc:
        raise HTTPException(status_code=403, detail=f"Account limit reached ({max_acc}). Upgrade your plan to link more accounts.")

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

@app.post("/api/telegram/accounts/{phone_number}/sync")
async def sync_account_profile(phone_number: str, user_id: str = Depends(get_current_user_id)):
    """Manually refresh profile photo, name, and username from Telegram."""
    try:
        client = await POOL.get_client(user_id, phone_number)
        profile_data = await fetch_tg_profile_data(client, phone_number)
        profile: Dict[str, Any] = cast(Dict[str, Any], profile_data)
        
        conn = get_db_connection()
        conn.execute(
            """UPDATE accounts SET 
               first_name = ?, last_name = ?, username = ?, profile_photo = ?, country = ?, status = 'active' 
               WHERE phone_number = ? AND user_id = ?""",
            (profile['first_name'], profile['last_name'], profile['username'], 
             profile['profile_photo'], profile['country'], phone_number, user_id)
        )
        if hasattr(conn, "commit"): conn.commit()
        if hasattr(conn, "close"): conn.close()
        
        return {"status": "success", "profile": profile}
    except Exception as e:
        log_debug(f"SYNC_ERROR for {phone_number}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Sync failed: {str(e)}")

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
        
        # Pull dialogs safely, catching flood or timeout issues at the generator level
        try:
            async for dialog in client.iter_dialogs(limit=1000):
                if dialog.is_group or dialog.is_channel:
                    name = getattr(dialog, 'name', '') or getattr(dialog, 'title', '') or str(dialog.id)
                    dialogs_list.append({
                        "id": str(dialog.id),
                        "name": name,
                        "title": name,
                        "is_group": dialog.is_group,
                        "is_channel": dialog.is_channel
                    })
        except Exception as dialog_err:
            log_debug(f"DIALOGS_GENERATOR_ERROR for {req.phone_number}: {str(dialog_err)}")
            # We already fetched some dialogs, just stop and return what we have instead of crashing the whole page.
            pass
            
        return {"dialogs": dialogs_list}
    except Exception as e:
        log_debug(f"DIALOGS_ERROR for {req.phone_number}: {str(e)}")
        # Send empty array to avoid breaking the frontend dropdown UI state
        return {"dialogs": []}


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
                   first_name, last_name, username, profile_photo, country, created_at, user_id, is_active
            FROM accounts
        """).fetchall()
    else:
        # Regular user only sees their own accounts
        rows = conn.execute("""
            SELECT phone_number, status, api_id, api_hash, 
                   first_name, last_name, username, profile_photo, country, created_at, user_id, is_active
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
            "created_at": row[9],
            "user_id": row[10],
            "is_active": row[11]
        })
    return {"accounts": accounts}

@app.post("/api/telegram/accounts/{phone_number}/active")
async def set_active_account(phone_number: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    try:
        # 1. Deactivate all other accounts for this user
        conn.execute("UPDATE accounts SET is_active = 0 WHERE user_id = ?", (user_id,))
        # 2. Activate the selected account
        conn.execute("UPDATE accounts SET is_active = 1 WHERE phone_number = ? AND user_id = ?", (phone_number, user_id))
        if hasattr(conn, "commit"): conn.commit()
        return {"status": "success", "msg": f"Account {phone_number} is now active."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if hasattr(conn, "close"): conn.close()
@app.delete("/api/telegram/accounts/{phone_number}")
async def delete_account(phone_number: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    if user_id == "admin_virtual_id":
        conn.execute("DELETE FROM accounts WHERE phone_number = ?", (phone_number,))
    else:
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
    if user_id == "admin_virtual_id":
        row = conn.execute("SELECT session_string FROM accounts WHERE phone_number = ?", (phone_number,)).fetchone()
    else:
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
                                
                        
                        # Check if it actually exists if we found 0 members or if it's from Lyzem (highly prone to dead links)
                        v_info = await verify_telegram_info(username)
                        if not v_info["exists"]:
                            continue
                        
                        # Use verified count if available
                        if v_info["participants_count"] > 0:
                            members = v_info["participants_count"]
                            title = v_info["title"] or title

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
                        # Auto-saving disabled - user must manually select and save to leads
                        # if user_id: asyncio.create_task(asyncio.to_thread(lambda: save_scraped_group(user_id, item))) # type: ignore
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
        # Generic variations
        "official", "group", "channel", "community", "chat", "hub",
        "network", "team", "zone", "world", "global", "vip", "pro",
        "2", "3", "online", "free", "live", "top", "best", "new",
        "real", "original", "main", "updates", "news", "info",
        "global chat", "portal", "support", "service", "market",
        "store", "shop", "deals", "premium", "lite", "backup",
        "archive", "community hub", "discussion", "lounge",
        "broadcast", "alerts", "notices", "leads", "clients",
        "customers", "hq", "international", "connect", "links",
        "services", "help", "prices", "vip access", "admin",
        "global group", "hub chat", "direct", "access", "portal hub",
        "official group", "official channel", "community chat", "leads group",
        
        # 25+ Hyper-Niche Targeted Words (IPTV, Crypto, Marketing, Tools)
        "streams", "vvod", "players", "subscriptions", "servers", 
        "resellers", "panels", "smart tv", "firestick", "movies", 
        "series", "sports", "signals", "trading", "crypto", "bitcoin",
        "forex", "investments", "airdrops", "nft", "web3", "calls", 
        "pumps", "marketing", "seo", "b2b", "leads gen", "traffic",
        "affiliate", "ecommerce", "dropshipping", "sales", "ads", 
        "tools", "software", "development", "coders", "bots", "api",
        "tech", "designs", "promotions", "freelancers", "gigs", "jobs"

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
                    search_result = await client(SearchRequest(q=q, limit=500))

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
                        
                        # PREFER username as the ID if it exists - globally resolvable!
                        final_id = f"@{username}" if username else chat_id_str
                        
                        participants_count = (
                            getattr(chat, 'participants_count', 0)
                            or getattr(chat, 'megagroup_participants', 0)
                            or 0
                        )
                        chat_type = 'channel' if getattr(chat, 'broadcast', False) else 'group'
                        item = {
                            "id": final_id,
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
                        # Auto-saving disabled - user must manually select and save to leads
                        # if user_id: asyncio.create_task(asyncio.to_thread(lambda: save_scraped_group(user_id, item)))

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
        # REMOVED disconnect() to keep POOL connections alive for campaigns
    
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
                                # Verification boost for Spider results (expiring links)
                                v_info = await verify_telegram_info(l_lower)
                                if not v_info["exists"]:
                                    continue

                                item2 = {
                                    "id": f"@{l_lower}",
                                    "title": v_info["title"] or l,
                                    "username": l_lower,
                                    "participants_count": v_info["participants_count"],
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
    # Premium check
    user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user_row and user_id != "admin_virtual_id":
        if hasattr(conn, "close"): conn.close()
        raise HTTPException(status_code=404, detail="User profile not found.")
    
    # Handle Virtual Admin
    if user_id == "admin_virtual_id":
        plan = "premium"
        allowed_limit = 1000
        max_keywords = 9999
        current_keywords = 0
    else:
        # Reset daily counts if needed
        check_and_reset_daily_limits(conn, user_id, user_row)
        
        plan = user_row["plan"] or "free"
        plan_cfg = PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])
        
        # Check Premium Access
        if not plan_cfg["has_premium_access"]:
            if hasattr(conn, "close"): conn.close()
            raise HTTPException(status_code=403, detail=f"Access Denied: The {plan.capitalize()} plan does not include Scraper access. Upgrade to UNLOCK.")
        
        allowed_limit = user_row["scrape_limit"] or plan_cfg["scrape_limit"]
        max_keywords = int(user_row["max_daily_keywords"] or plan_cfg["max_daily_keywords"])
        current_keywords = int(user_row["daily_keyword_count"] or 0)
        
        if current_keywords >= max_keywords and plan != "unlimited":
            if hasattr(conn, "close"): conn.close()
            raise HTTPException(status_code=403, detail="Daily usage limit reached for scraping. Reset at Midnight UTC.")

        # Increment keyword use
        if plan != "unlimited":
            conn.execute("UPDATE users SET daily_keyword_count = daily_keyword_count + 1 WHERE id = ?", (user_id,))
            if hasattr(conn, "commit"): conn.commit()

    if plan == "unlimited" or user_id == "admin_virtual_id":
        final_limit: int = 999999999
    else:
        final_limit: int = allowed_limit

    if user_id == "admin_virtual_id":
        if phone_number:
            rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE phone_number = ?", (phone_number,)).fetchall()
        else:
            rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE status = 'active' ORDER BY is_active DESC LIMIT 1").fetchall()
    elif phone_number:
        rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE phone_number = ? AND user_id = ?", (phone_number, user_id)).fetchall()
    else:
        # Prioritize explicitly active account, fallback to any active status account
        rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE user_id = ? AND status = 'active' ORDER BY is_active DESC LIMIT 1", (user_id,)).fetchall()
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
        state = {"count": 0}
        try:
            while True:
                msg = await queue.get()  # pyre-ignore
                if msg["type"] == "result":
                    state["count"] += 1
                
                yield f"data: {json.dumps(msg)}\n\n"
                
                if msg["type"] == "result" and state["count"] >= final_limit:
                    yield f"data: {json.dumps({'type': 'done', 'msg': 'Scrape completed (limit reached)'})}\n\n"
                    bg_task.cancel()
                    break
                    
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
    if user_id == "admin_virtual_id":
        plan_cfg = PLAN_CONFIGS["unlimited"]
        max_keywords = 9999
        current_keywords = 0
        scrape_limit = 9999
        
        if phone_number:
            rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE phone_number = ?", (phone_number,)).fetchall()
        else:
            rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE status = 'active'").fetchall()
    else:
        user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user_row:
             if hasattr(conn, "close"): conn.close()
             raise HTTPException(status_code=404, detail="User not found")
        
        check_and_reset_daily_limits(conn, user_id, user_row)
        plan = (user_row["plan"] or "free")
        plan_cfg = PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])
        
        max_keywords = int(user_row["max_daily_keywords"] or plan_cfg["max_daily_keywords"])
        current_keywords = int(user_row["daily_keyword_count"] or 0)
        scrape_limit = int(user_row["scrape_limit"] or plan_cfg["scrape_limit"])

        if plan != "unlimited" and current_keywords >= max_keywords:
             if hasattr(conn, "close"): conn.close()
             raise HTTPException(status_code=403, detail="Daily search limit reached.")
        
        # Increment search count and Log Keyword
        if plan != "unlimited":
            conn.execute("UPDATE users SET daily_keyword_count = daily_keyword_count + 1 WHERE id = ?", (user_id,))
            
        # Global log for admin
        conn.execute(
            "INSERT INTO keyword_logs (user_id, username, keyword) VALUES (?, ?, ?)",
            (user_id, user_row["username"], query.strip())
        )
        if hasattr(conn, "commit"): conn.commit()

        if phone_number:
            rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE phone_number = ? AND user_id = ?", (phone_number, user_id)).fetchall()
        else:
            rows = conn.execute("SELECT session_string, api_id, api_hash, phone_number FROM accounts WHERE user_id = ? AND status = 'active'", (user_id,)).fetchall()

    if hasattr(conn, "close"): conn.close()

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
    
    # Enforce scrape_limit from plan - cast to Any to satisfy Pyre's slicing check
    final_list = cast(Any, final_list)[:scrape_limit]

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
    if user_id == "admin_virtual_id":
        row = conn.execute(
            "SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ?",
            (phone_number,)
        ).fetchone()
    else:
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
                    # Human Rhythms: Longer randomized intervals (45-120s)
                    wait_time = random.randint(45, 120)
                    
                    # Micro-Rest: Pause for 2 mins every 5 joins to avoid account flagging
                    if idx > 1 and (idx - 1) % 5 == 0:
                        for remaining in range(120, 0, -1):
                            yield f"data: {_json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'msg': f'Micro-Rest: Resuming in {remaining}s...', 'remaining': remaining})}\n\n"
                            await asyncio.sleep(1)

                    for remaining in range(wait_time, 0, -1):
                        yield f"data: {_json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'msg': f'Safety delay: {remaining}s...', 'remaining': remaining})}\n\n"
                        await asyncio.sleep(1)
                    
                    yield f"data: {_json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'msg': f'Joining {group_label}...'})}\n\n"
                    # Use pool-based client
                    await smart_join(client, g_id, str(user_id), str(phone_number))
                    
                    joined = joined + 1
                    yield f"data: {_json.dumps({'type': 'joined', 'name': group_label, 'idx': idx, 'total': total, 'joined': joined, 'failed': failed})}\n\n"
                except Exception as e:
                    from telethon.errors import FloodWaitError, ChannelsTooMuchError, UserDeactivatedError # type: ignore
                    err_r = str(e)
                    
                    if isinstance(e, FloodWaitError):
                        wait_seconds: int = cast(int, getattr(e, 'seconds', 0))
                        yield f"data: {_json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'msg': f'🚨 RATE LIMIT: Telegram says wait {wait_seconds}s. Use the manual Copy button if you are in a hurry.'})}\n\n"
                        # We stop the automated process for FloodWait to protect the account
                        break
                    
                    if "too many channels" in err_r.lower() or isinstance(e, ChannelsTooMuchError):
                        err_s = "Account Limit: You are in 500 groups already. Leave some groups first."
                    elif "privacy" in err_r.lower():
                        err_s = "Privacy: Group doesn't allow invites or joining."
                    elif "deactivated" in err_r.lower() or isinstance(e, UserDeactivatedError):
                        err_s = "Account Alert: This account seems banned/deactivated by Telegram."
                    elif "chat_admin_required" in err_r.lower():
                         err_s = "Restricted: Admin required to join."
                    else:
                        err_s = "Join Ignored: Telegram restricted this action. Use the 'Copy' button and join manually."
                    
                    failed = failed + 1
                    failed_groups.append({'name': group_label, 'reason': err_s})
                    yield f"data: {_json.dumps({'type': 'failed', 'name': group_label, 'reason': err_s, 'idx': idx, 'total': total, 'joined': joined, 'failed': failed})}\n\n"
            
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
        await smart_join(client, req.group_id, user_id, req.phone_number)
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
    user_row = conn.execute("SELECT plan FROM users WHERE id = ?", (user_id,)).fetchone()
    plan = user_row["plan"] if user_row else "free"
    plan_cfg = PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])
    
    if not plan_cfg["has_premium_access"] and user_id != "admin_virtual_id":
        if hasattr(conn, "close"): conn.close()
        return {"members": [], "locked": True}

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

# --- Monetization & Plans ---

class UserVitalsUpdateRequest(BaseModel):
    plan: str
    scrape_limit: Optional[int] = None
    max_accounts: Optional[int] = None
    max_daily_campaigns: Optional[int] = None
    max_daily_keywords: Optional[int] = None
    is_approved: int

@app.get("/api/admin/monetization/users")
async def get_monetization_users(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM users").fetchall()
    if hasattr(conn, "close"): conn.close()
    return {"users": [dict(
        id=r["id"], 
        username=r["username"], 
        plan=r["plan"], 
        scrape_limit=r["scrape_limit"], 
        max_accounts=r["max_accounts"], 
        max_daily_campaigns=r["max_daily_campaigns"],
        daily_campaign_count=r["daily_campaign_count"],
        max_daily_keywords=r["max_daily_keywords"],
        daily_keyword_count=r["daily_keyword_count"],
        is_approved=r["is_approved"], 
        total_scraped=r["total_scraped"], 
        payment_proof=r["payment_proof"],
        plan_activated_at=r["plan_activated_at"],
        plan_expires_at=r["plan_expires_at"],
        max_templates=r["max_templates"]
    ) for r in rows]}

@app.post("/api/admin/monetization/users/{uid}/vitals")
async def update_user_vitals(uid: str, req: UserVitalsUpdateRequest, admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    plan_cfg = PLAN_CONFIGS.get(req.plan, PLAN_CONFIGS["free"])
    
    # Use provided values or defaults from plan
    s_limit = req.scrape_limit if req.scrape_limit is not None else plan_cfg["scrape_limit"]
    m_acc = req.max_accounts if req.max_accounts is not None else plan_cfg["max_accounts"]
    m_camp = req.max_daily_campaigns if req.max_daily_campaigns is not None else plan_cfg["max_daily_campaigns"]
    m_key = req.max_daily_keywords if req.max_daily_keywords is not None else plan_cfg["max_daily_keywords"]
    
    # Handle Subscription Dates
    activated_at = None
    expires_at = None
    if req.plan != 'free' and req.is_approved:
        now = datetime.now()
        activated_at = now.strftime('%Y-%m-%dT%H:%M')
        expires_at = (now + timedelta(days=30)).strftime('%Y-%m-%dT%H:%M')

    conn.execute(
        """UPDATE users SET 
           plan = ?, scrape_limit = ?, max_accounts = ?, 
           max_daily_campaigns = ?, max_daily_keywords = ?, 
           is_approved = ?, plan_activated_at = ?, plan_expires_at = ?
           WHERE id = ?""",
        (req.plan, s_limit, m_acc, m_camp, m_key, req.is_approved, activated_at, expires_at, uid)
    )
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success", "activated_at": activated_at, "expires_at": expires_at}

@app.get("/api/admin/monetization/coupons")
async def get_coupons_admin(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM coupons ORDER BY created_at DESC").fetchall()
    if hasattr(conn, "close"): conn.close()
    def _safe(r, k):
        try: return r[k]
        except: return None
    return {"coupons": [dict(id=r["id"], code=r["code"], price=r["price"], is_active=r["is_active"], created_at=r["created_at"], max_daily_campaigns=_safe(r, "max_daily_campaigns"), max_daily_keywords=_safe(r, "max_daily_keywords"), scrape_limit=_safe(r, "scrape_limit")) for r in rows]}

class CouponCreateRequest(BaseModel):
    code: str
    price: int
    max_daily_campaigns: Optional[int] = None
    max_daily_keywords: Optional[int] = None
    scrape_limit: Optional[int] = None

@app.post("/api/admin/monetization/coupons")
async def create_coupon_admin(req: CouponCreateRequest, admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO coupons (code, price, max_daily_campaigns, max_daily_keywords, scrape_limit) 
               VALUES (?, ?, ?, ?, ?)""", 
            (req.code, req.price, req.max_daily_campaigns, req.max_daily_keywords, req.scrape_limit)
        )
        if hasattr(conn, "commit"): conn.commit()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if hasattr(conn, "close"): conn.close()

@app.delete("/api/admin/monetization/coupons/{code}")
async def delete_coupon_admin(code: str, admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    conn.execute("DELETE FROM coupons WHERE code = ?", (code,))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

# --- User Side Monetization ---

@app.get("/api/monetization/status")
async def get_user_status(user_id: str = Depends(get_current_user_id)):
    if user_id == "admin_virtual_id":
        cfg = PLAN_CONFIGS["unlimited"]
        # Fetch 'unlimited' config
        cfg = PLAN_CONFIGS.get("unlimited", PLAN_CONFIGS["free"])
        return {
            "status": "success",
            "plan": "unlimited",
            "scrape_limit": cfg["scrape_limit"],
            "max_accounts": cfg["max_accounts"],
            "max_daily_campaigns": cfg["max_daily_campaigns"],
            "daily_campaign_count": 0,
            "max_daily_keywords": cfg["max_daily_keywords"],
            "daily_keyword_count": 0,
            "max_templates": cfg["max_templates"],
            "template_count": 0,
            "email": "admin@arkitel.app",
            "is_approved": 1,
            "has_proof": True
        }

    conn = get_db_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row:
            # Reset daily counts if needed
            check_and_reset_daily_limits(conn, user_id, row)
            # Fetch latest count after possible reset
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
            
        t_count = conn.execute("SELECT COUNT(*) FROM templates WHERE user_id = ?", (user_id,)).fetchone()[0]
    finally:
        if hasattr(conn, "close"): conn.close()
    
    # Tier mapping
    p_cfg = PLAN_CONFIGS.get(row["plan"] or "free", PLAN_CONFIGS["free"])
    
    return {
        "status": "success",
        "plan": row["plan"] or "free",
        "username": row["username"], 
        "email": row["email"] or f"{row['username']}@arkitel.app",
        "scrape_limit": row["scrape_limit"] or p_cfg["scrape_limit"],
        "max_accounts": row["max_accounts"] or p_cfg["max_accounts"],
        "max_daily_campaigns": row["max_daily_campaigns"] or p_cfg["max_daily_campaigns"],
        "daily_campaign_count": row["daily_campaign_count"] or 0,
        "max_daily_keywords": row["max_daily_keywords"] or p_cfg["max_daily_keywords"],
        "daily_keyword_count": row["daily_keyword_count"] or 0,
        "max_templates": p_cfg.get("max_templates", 1),
        "template_count": t_count,
        "is_approved": row["is_approved"],
        "has_proof": bool(row["payment_proof"]),
        "plan_expires_at": row["plan_expires_at"]
    }

@app.post("/api/monetization/apply-coupon")
async def apply_coupon(code: str, user_id: str = Depends(get_current_user_id)):
    code = code.strip().upper()
    conn = get_db_connection()
    try:
        coupon = conn.execute("SELECT * FROM coupons WHERE UPPER(code) = ? AND is_active = 1", (code,)).fetchone()
        if not coupon:
            raise HTTPException(status_code=400, detail="Invalid or expired coupon code. Please check and try again.")
        
        price = int(coupon["price"])
        if price == 0:
            # FREE access code - unlock Premium immediately (highest plan)
            # Set limits to NULL so they fall back to PLAN_CONFIGS
            conn.execute(
                """UPDATE users SET 
                   plan = 'premium', is_approved = 1, 
                   max_accounts = NULL, scrape_limit = NULL,
                   max_daily_campaigns = NULL, max_daily_keywords = NULL
                   WHERE id = ?""",
                (user_id,)
            )
            # Deactivate coupon after single use
            conn.execute("UPDATE coupons SET is_active = 0 WHERE UPPER(code) = ?", (code,))
            if hasattr(conn, "commit"): conn.commit()
            return {"status": "success", "message": "Premium plan activated successfully!", "discount": "free"}
        else:
            # Discount code - deactivate so it can't be reused, user still needs to pay 'price'
            conn.execute("UPDATE coupons SET is_active = 0 WHERE UPPER(code) = ?", (code,))
            if hasattr(conn, "commit"): conn.commit()
            return {"status": "success", "message": f"Coupon applied! Pay only \u20a6{price:,} instead.", "discount": "partial", "new_price": price}
    finally:
        if hasattr(conn, "close"): conn.close()

class PaymentProofRequest(BaseModel):
    proof_details: str
    amount: int

@app.post("/api/monetization/submit-proof")
async def submit_proof(req: PaymentProofRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    try:
        # Update user record with proof string
        conn.execute("UPDATE users SET payment_proof = ? WHERE id = ?", (req.proof_details, user_id))
        # Record in payments table
        conn.execute(
            "INSERT INTO payments (user_id, amount, proof_details, status) VALUES (?, ?, ?, ?)",
            (user_id, req.amount, req.proof_details, 'pending')
        )
        if hasattr(conn, "commit"): conn.commit()
        return {"status": "success", "message": "Proof submitted. Admin will verify shortly."}
    finally:
        if hasattr(conn, "close"): conn.close()

class PaystackVerifyRequest(BaseModel):
    reference: str
    plan_key: str

@app.post("/api/monetization/verify-paystack")
async def verify_paystack(req: PaystackVerifyRequest, user_id: str = Depends(get_current_user_id)):
    """Verifies a Paystack transaction and upgrades the user automatically."""
    secret_key = os.getenv("PAYSTACK_SECRET_KEY")
    if not secret_key:
        raise HTTPException(status_code=500, detail="Payment gateway not configured.")

    async with httpx.AsyncClient() as client:
        try:
            headers = {"Authorization": f"Bearer {secret_key}"}
            response = await client.get(f"https://api.paystack.co/transaction/verify/{req.reference}", headers=headers)
            res_data = response.json()

            if response.status_code == 200 and res_data.get("status") and res_data["data"]["status"] == "success":
                # Payment confirmed! Upgrade user.
                plan_key = req.plan_key
                plan_cfg = PLAN_CONFIGS.get(plan_key, PLAN_CONFIGS["basic"])
                
                # Subscription timing
                now = datetime.now()
                act_date = now.strftime('%Y-%m-%dT%H:%M')
                exp_date = (now + timedelta(days=30)).strftime('%Y-%m-%dT%H:%M')

                conn = get_db_connection()
                try:
                    conn.execute(
                        """UPDATE users SET 
                           plan = ?, is_approved = 1, payment_proof = ?, 
                           scrape_limit = NULL, max_accounts = NULL, 
                           max_daily_campaigns = NULL, max_daily_keywords = NULL,
                           plan_activated_at = ?, plan_expires_at = ?
                           WHERE id = ?""",
                        (plan_key, f"Paystack:{req.reference}", act_date, exp_date, user_id)
                    )
                    conn.execute(
                        "INSERT INTO payments (user_id, amount, proof_details, status) VALUES (?, ?, ?, ?)",
                        (user_id, res_data["data"]["amount"] / 100, f"Paystack:{req.reference}", 'completed')
                    )
                    if hasattr(conn, "commit"): conn.commit()
                finally:
                    if hasattr(conn, "close"): conn.close()
                
                return {"status": "success", "message": f"Upgrade to {plan_key} successful!"}
            else:
                raise HTTPException(status_code=400, detail="Payment verification failed.")
        except Exception as e:
            log_debug(f"Paystack Verify Error: {str(e)}")
            raise HTTPException(status_code=500, detail="Verification failed.")

@app.post("/api/payments/webhook")
async def paystack_webhook(request: Request):
    """Reliability backup for Paystack payments."""
    # Note: In production you should verify the x-paystack-signature header
    payload = await request.json()
    if payload.get("event") == "charge.success":
        data = payload["data"]
        ref = data["reference"]
        cust_email = data["customer"]["email"]
        amount = data["amount"] / 100
        
        # Determine plan from amount or metadata
        plan_key = "basic"
        if amount >= 5000: plan_key = "premium"
        elif amount >= 3500: plan_key = "standard"
        
        # Find user by email (mapping email to username if needed)
        conn = get_db_connection()
        try:
            # We assume username or a stored email matches
            user = conn.execute("SELECT id FROM users WHERE username = ? OR id = ?", (cust_email, data.get("metadata", {}).get("user_id"))).fetchone()
            if user:
                u_id = user["id"]
                plan_cfg = PLAN_CONFIGS.get(plan_key, PLAN_CONFIGS["basic"])
                now = datetime.now()
                act_date = now.strftime('%Y-%m-%dT%H:%M')
                exp_date = (now + timedelta(days=30)).strftime('%Y-%m-%dT%H:%M')
                
                conn.execute(
                    """UPDATE users SET plan = ?, is_approved = 1, payment_proof = ?,
                       plan_activated_at = ?, plan_expires_at = ?
                       WHERE id = ? AND (plan = 'free' OR plan IS NULL)""",
                    (plan_key, f"Webhook:{ref}", act_date, exp_date, u_id)
                )
                if hasattr(conn, "commit"): conn.commit()
        finally:
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
    # Premium check
    user_row = conn.execute("SELECT plan FROM users WHERE id = ?", (user_id,)).fetchone()
    plan = user_row["plan"] if user_row else "free"
    plan_cfg = PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])
    
    if not plan_cfg["has_premium_access"] and user_id != "admin_virtual_id":
        if hasattr(conn, "close"): conn.close()
        return {"groups": [], "locked": True}

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

@app.get("/api/telegram/leads/joined-status")
async def get_joined_status(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    rows = conn.execute("SELECT group_id FROM account_joins WHERE user_id = ?", (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    return {"joined_ids": [r[0] for r in rows]}

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
    exclude_groups: Optional[List[str]] = None
    interval_hours: Optional[int] = None
    interval_minutes: Optional[int] = None
    phone_number: Optional[str] = None

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
        updates.append("total_targets = ?")
        params.append(json.dumps(req.target_groups))
        params.append(len(cast(list, req.target_groups)))
    if req.interval_hours is not None:
        updates.append("interval_hours = ?")
        params.append(req.interval_hours)
    if req.interval_minutes is not None:
        updates.append("interval_minutes = ?")
        params.append(req.interval_minutes)
    if req.phone_number is not None:
        updates.append("phone_number = ?")
        params.append(req.phone_number)
    if req.exclude_groups is not None:
        updates.append("exclude_groups = ?")
        params.append(json.dumps(req.exclude_groups))
    
    if updates:
        # Reset to pending on edit so it re-runs
        updates.append("status = 'pending'")
        updates.append("failed_groups = '[]'")
        updates.append("sent_count = 0")
        
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
    conn = get_db_connection()
    try:
        # Plan Check for Extraction
        if user_id != "admin_virtual_id":
            user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user_row:
                raise HTTPException(status_code=404, detail="User not found")
            
            plan = user_row["plan"] or "free"
            plan_cfg = PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])
            if not plan_cfg.get("has_premium_access"):
                raise HTTPException(status_code=403, detail="Member Extraction is a Premium feature. Upgrade to Standard or Premium to unlock.")

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

# Redundant endpoint removed (get_member_leads was a duplicate of get_saved_members)

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



# --- TEMPLATES ENDPOINTS ---
@app.get("/api/telegram/templates")
async def get_templates(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    rows = conn.execute("SELECT id, name, content FROM templates WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    return {"templates": [dict(id=r[0], name=r[1], content=r[2]) for r in rows]}

@app.post("/api/telegram/templates")
async def create_template(req: TemplateRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    try:
        # Check limits
        u_row = conn.execute("SELECT plan FROM users WHERE id = ?", (user_id,)).fetchone()
        plan = u_row["plan"] if u_row else "free"
        plan_cfg = PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])
        max_templates = plan_cfg.get("max_templates", 1)
        
        current_count = conn.execute("SELECT COUNT(*) FROM templates WHERE user_id = ?", (user_id,)).fetchone()[0]
        if current_count >= max_templates:
            raise HTTPException(status_code=403, detail=f"Your {plan.capitalize()} plan only allows {max_templates} templates.")

        conn.execute("INSERT INTO templates (user_id, name, content) VALUES (?, ?, ?)", (user_id, req.name, req.content))
        if hasattr(conn, "commit"): conn.commit()
    finally:
        if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

@app.get("/api/admin/templates")
async def admin_get_all_templates(admin_id: str = Depends(get_current_admin)):
    """Allows admin to see all templates from all users."""
    conn = get_db_connection()
    rows = conn.execute("""
        SELECT t.*, u.username as creator 
        FROM templates t 
        JOIN users u ON t.user_id = u.id 
        ORDER BY t.created_at DESC
    """).fetchall()
    if hasattr(conn, "close"): conn.close()
    return {"templates": [dict(r) for r in rows]}

@app.delete("/api/telegram/templates/{template_id}")
async def delete_template(template_id: int, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    conn.execute("DELETE FROM templates WHERE id = ? AND user_id = ?", (template_id, user_id))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

# --- PERMANENT EXCLUDES ---
@app.get("/api/users/permanent-excludes")
async def get_permanent_excludes(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    row = conn.execute("SELECT permanent_excludes FROM users WHERE id = ?", (user_id,)).fetchone()
    if hasattr(conn, "close"): conn.close()
    if row:
        return {"ids": json.loads(row[0] or "[]")}
    return {"ids": []}

@app.post("/api/users/permanent-excludes")
async def update_permanent_excludes(req: PermanentExcludeRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    conn.execute("UPDATE users SET permanent_excludes = ? WHERE id = ?", (json.dumps(req.ids), user_id))
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success"}

# Removed redundant get_accounts (already refactored earlier)

@app.post("/api/telegram/campaigns/{task_id}/toggle-pause")
async def toggle_campaign_pause(task_id: int, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    try:
        row = conn.execute("SELECT user_id, status FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        if row["user_id"] != user_id and user_id != "admin_virtual_id":
             raise HTTPException(status_code=403, detail="Unauthorized")
        
        current_status = row["status"]
        if current_status == "processing":
            new_status = 'paused'
        elif current_status == "paused":
            new_status = 'pending'
        else:
            raise HTTPException(status_code=400, detail="Campaign can only be paused while processing, or resumed while paused.")
            
        conn.execute("UPDATE tasks SET status = ? WHERE id = ?", (new_status, task_id))
        if hasattr(conn, "commit"): conn.commit()
        return {"status": "success", "new_status": new_status}
    finally:
        if hasattr(conn, "close"): conn.close()


@app.get("/api/telegram/campaigns")
async def get_campaigns(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    tasks = conn.execute(
        "SELECT id, phone_number, scheduled_time, message_text, target_groups, status, interval_hours, interval_minutes, total_targets, sent_count, batch_number, failed_groups, exclude_groups FROM tasks WHERE user_id = ? ORDER BY scheduled_time DESC", 
        (user_id,)
    ).fetchall()
    if hasattr(conn, "close"): conn.close()
    
    return {
        "campaigns": [
            dict(id=t[0], phone_number=t[1], scheduled_time=t[2], message=t[3], groups=t[4], status=t[5], interval_hours=t[6], interval_minutes=t[7], total_targets=t[8], sent_count=t[9], batch_number=t[10], failed_groups=t[11], exclude_groups=t[12]) 
            for t in tasks
        ]
    }

@app.post("/api/telegram/campaigns")
async def create_campaign(req: CampaignRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    # Plan Limit Check
    if user_id != "admin_virtual_id":
        user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user_row:
            if hasattr(conn, "close"): conn.close()
            raise HTTPException(status_code=404, detail="User not found")
        
        # Reset daily counts if needed
        check_and_reset_daily_limits(conn, user_id, user_row)
        
        plan = user_row["plan"] or "free"
        plan_cfg = PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])
        
        max_daily = int(user_row["max_daily_campaigns"] or plan_cfg["max_daily_campaigns"])
        current_daily = int(user_row["daily_campaign_count"] or 0)
        
        if current_daily >= max_daily and plan != "unlimited":
            if hasattr(conn, "close"): conn.close()
            raise HTTPException(status_code=403, detail=f"Daily limit reached ({max_daily}/{max_daily}). Upgrade your plan to send more.")
        
        # WE NO LONGER INCREMENT HERE. WE INCREMENT ON SUCCESSFUL SEND IN THE BACKGROUND.


    try:
        # The schedule_time sent by the frontend must already be in UTC.
        # Frontend converts datetime-local (local time) -> UTC before sending.
        # We store it as-is and the poller compares against datetime.now(timezone.utc).
        now_utc = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M')
        print(f"CAMPAIGN: New campaign '{req.name}' | Scheduled(UTC): {req.schedule_time} | Server UTC now: {now_utc}")
        # Truncate to minutes to match poller format exactly
        clean_time = req.schedule_time
        if 'T' in clean_time:
            # If it has seconds, drop them
            parts = clean_time.split(':')
            if len(parts) > 2:
                clean_time = f"{parts[0]}:{parts[1]}"

        conn.execute(
            "INSERT INTO tasks (user_id, name, phone_number, scheduled_time, message_text, target_groups, status, interval_hours, interval_minutes, total_targets, sent_count, batch_number, failed_groups, exclude_groups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, req.name, req.phone_number, clean_time, req.message, str(req.groups), "pending", req.interval_hours, req.interval_minutes, len(req.groups), 0, 1, "[]", str(req.exclude_groups))
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

@app.get("/api/admin/keyword-logs")
async def get_keyword_logs(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    logs = conn.execute("SELECT * FROM keyword_logs ORDER BY created_at DESC LIMIT 500").fetchall()
    if hasattr(conn, "close"): conn.close()
    return {"logs": [dict(l) for l in logs]}

# --- Admin Endpoints ---

@app.post("/api/admin/maintenance/clear-keyword-logs")
async def clear_keyword_logs(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    conn.execute("DELETE FROM keyword_logs")
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success", "message": "All keyword search history has been purged."}

@app.post("/api/admin/maintenance/clear-templates")
async def clear_templates(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    conn.execute("DELETE FROM templates")
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    return {"status": "success", "message": "All user templates have been purged."}

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

@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin_id: str = Depends(get_current_admin)):
    """Deletes a user and all their associated data from the system."""
    if user_id == "admin_virtual_id":
        raise HTTPException(status_code=400, detail="Cannot delete the global virtual admin.")
        
    conn = get_db_connection()
    try:
        # Check if user is an admin - prevent deleting real admins as a safety measure
        user = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if user and user[0] == 'admin':
            raise HTTPException(status_code=400, detail="Cannot delete another admin account.")
            
        # Delete user
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        # Cascade manually for SQLite/Turso:
        conn.execute("DELETE FROM accounts WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM tasks WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM leads WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM scraped_groups WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM scrape_history WHERE user_id = ?", (user_id,))
        
        if hasattr(conn, "commit"): conn.commit()
        log_debug(f"ADMIN: Completely deleted user {user_id}")
        return {"status": "success", "message": f"User {user_id} and all their data deleted."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if hasattr(conn, "close"): conn.close()

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
    
    # Monetization stats
    total_rev = conn.execute("SELECT SUM(amount) FROM payments WHERE status = 'approved'").fetchone()[0] or 0
    pending_approvals = conn.execute("SELECT COUNT(*) FROM users WHERE payment_proof IS NOT NULL AND plan = 'free'").fetchone()[0]

    # Per user stats
    user_stats = conn.execute('''
        SELECT u.id, u.username, u.is_active, u.plan,
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
            "leads": total_leads,
            "revenue": total_rev,
            "pending": pending_approvals
        },
        "broadcasts": [dict(id=b["id"], message=b["message"], type=b["type"], created_at=b["created_at"]) for b in broadcasts],
        "per_user": [dict(id=s[0], username=s[1], is_active=bool(s[2]), plan=s[3], accounts=s[4], tasks=s[5], leads=s[6]) for s in user_stats],
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
            messages_sent = conn.execute("SELECT SUM(sent_count) FROM tasks").fetchone()[0] or 0
            
            tasks_rows = conn.execute(
                "SELECT phone_number, status, message_text, scheduled_time FROM tasks ORDER BY scheduled_time DESC LIMIT 5"
            ).fetchall()
            
            trends = []
            for i in range(6, -1, -1):
                day = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
                count = conn.execute(
                    "SELECT SUM(sent_count) FROM tasks WHERE scheduled_time LIKE ?",
                    (f"{day}%",)
                ).fetchone()[0] or 0
                trends.append(count)
        else:
            # Core counts for regular user
            total_accounts = conn.execute("SELECT COUNT(*) FROM accounts WHERE user_id = ? AND status = 'active'", (user_id,)).fetchone()[0]
            # Dashboard leads should strictly match what the user sees in the Leads page
            c_scraped = conn.execute("SELECT COUNT(*) FROM scraped_groups WHERE user_id = ?", (user_id,)).fetchone()[0]
            c_members = conn.execute("SELECT COUNT(*) FROM leads WHERE user_id = ?", (user_id,)).fetchone()[0]
            total_leads = c_scraped + c_members
            
            pending_tasks = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'pending'", (user_id,)).fetchone()[0]
            messages_sent = conn.execute("SELECT SUM(sent_count) FROM tasks WHERE user_id = ?", (user_id,)).fetchone()[0] or 0
            
            tasks_rows = conn.execute(
                "SELECT phone_number, status, message_text, scheduled_time FROM tasks WHERE user_id = ? ORDER BY scheduled_time DESC LIMIT 5", 
                (user_id,)
            ).fetchall()
            
            trends = []
            for i in range(6, -1, -1):
                day = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
                count = conn.execute(
                    "SELECT SUM(sent_count) FROM tasks WHERE user_id = ? AND scheduled_time LIKE ?",
                    (user_id, f"{day}%")
                ).fetchone()[0] or 0
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

class PlanUpdateRequest(BaseModel):
    key: str
    name: str
    price: int
    max_daily_campaigns: int
    max_accounts: int
    max_daily_keywords: int
    scrape_limit: int
    max_templates: int
    has_premium_access: bool
    perks: List[str]

@app.get("/api/admin/plans")
async def admin_get_plans(admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM plans").fetchall()
    if hasattr(conn, "close"): conn.close()
    return [dict(r) for r in rows]

@app.get("/api/monetization/plans")
async def get_plans_public():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM plans").fetchall()
    if hasattr(conn, "close"): conn.close()
    return [dict(r) for r in rows]

@app.post("/api/admin/plans/update")
async def admin_update_plan(req: PlanUpdateRequest, admin_id: str = Depends(get_current_admin)):
    conn = get_db_connection()
    conn.execute(
        """INSERT OR REPLACE INTO plans 
           (key, name, price, max_daily_campaigns, max_accounts, max_daily_keywords, scrape_limit, max_templates, has_premium_access, perks) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (req.key, req.name, req.price, req.max_daily_campaigns, req.max_accounts, req.max_daily_keywords, req.scrape_limit, req.max_templates, 1 if req.has_premium_access else 0, json.dumps(req.perks))
    )
    if hasattr(conn, "commit"): conn.commit()
    if hasattr(conn, "close"): conn.close()
    
    # Reload global configs
    global PLAN_CONFIGS
    PLAN_CONFIGS = get_plan_configs()
    return {"status": "success"}

@app.get("/")
async def root():
    return {"status": "ok", "message": "Telegram Automation API is running"}

async def task_poller():
    active_tasks = set()

    async def run_single_task(task_id, message, groups_str, phone_num, u_id, interval, scheduled_time, exclude_groups_str="[]", processed_groups_str="[]", sent_count_init=0, failed_groups_str="[]"):
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

            try:
                exclude_list = ast.literal_eval(exclude_groups_str) if exclude_groups_str else []
            except:
                exclude_list = []
            
            # Fetch and merge permanent excludes for this user
            try:
                ex_conn = get_db_connection()
                u_ex_row = ex_conn.execute("SELECT permanent_excludes FROM users WHERE id = ?", (u_id,)).fetchone()
                if u_ex_row and u_ex_row[0]:
                    try:
                        p_ex = json.loads(u_ex_row[0])
                        if isinstance(p_ex, list):
                            exclude_list.extend(p_ex)
                    except: pass
                if hasattr(ex_conn, "close"): ex_conn.close()
            except Exception as e:
                print(f"BKG_TASK[{task_id}]: Error loading permanent excludes: {e}")

            # Normalize exclude_list
            exclude_list = list(set([str(e).strip() for e in (exclude_list if isinstance(exclude_list, list) else [])]))

            def recursive_spin(text: str) -> str:
                text_obj = str(text)
                while '{' in text_obj and '}' in text_obj:
                    # Simple regex for leaf-level spintax: {a|b|c}
                    text_obj = re.sub(r'\{([^{}]*)\}', lambda m: random.choice(m.group(1).split('|')), text_obj)
                return str(text_obj)

            try:
                processed_list = ast.literal_eval(processed_groups_str) if processed_groups_str else []
            except:
                processed_list = []
            processed_list = [str(e).strip() for e in (processed_list if isinstance(processed_list, list) else [])]

            try:
                failed_list = ast.literal_eval(failed_groups_str) if failed_groups_str else []
            except:
                failed_list = []
            if not isinstance(failed_list, list): failed_list = []
            
            sent_ok_stats = [sent_count_init]
            # High Fidelity Extraction Loop
            for raw_group in target_groups:
                # Dynamic Status Check (Abort if User Stopped the Campaign)
                status_conn = get_db_connection()
                current_status = status_conn.execute("SELECT status FROM tasks WHERE id = ?", (task_id,)).fetchone()
                if hasattr(status_conn, "close"): status_conn.close()
                if not current_status or current_status["status"] != "processing":
                    log_debug(f"BKG_TASK[{task_id}]: Task externally aborted or stopped. Status: {current_status['status'] if current_status else 'None'}. Halting sender loop.")
                    break

                # Global User Limit Check (Enforce Plan Quotas in Real-Time)
                quota_conn = get_db_connection()
                try:
                    u_row = quota_conn.execute("SELECT plan, daily_campaign_count, max_daily_campaigns FROM users WHERE id = ?", (u_id,)).fetchone()
                    if u_row:
                        u_plan = u_row["plan"] or "free"
                        u_count = u_row["daily_campaign_count"] or 0
                        u_cfg = PLAN_CONFIGS.get(u_plan, PLAN_CONFIGS["free"])
                        u_max = u_row["max_daily_campaigns"] or u_cfg["max_daily_campaigns"]
                        
                        if u_plan != "unlimited" and u_count >= u_max:
                            log_debug(f"BKG_TASK[{task_id}]: GLOBAL QUOTA REACHED ({u_count}/{u_max}). Stopping campaign for today.")
                            quota_conn.execute("UPDATE tasks SET status = 'completed' WHERE id = ?", (task_id,))
                            if hasattr(quota_conn, "commit"): quota_conn.commit()
                            break
                finally:
                    if hasattr(quota_conn, "close"): quota_conn.close()

                try:
                    # Clean and resolve ID format (int vs str)
                    group = str(raw_group).strip()
                    if group in exclude_list:
                        log_debug(f"BKG_TASK[{task_id}]: Skipping {group} (Excluded by user)")
                        continue
                    if group in processed_list:
                        log_debug(f"BKG_TASK[{task_id}]: Skipping {group} (Already processed in this batch)")
                        continue

                    # Mark as processed immediately so we don't repeat on crash
                    processed_list.append(group)

                    target_id = group
                    if group.lstrip('-').isdigit():
                        target_id = int(group)

                    await asyncio.sleep(random.uniform(3.0, 7.0)) # Safety delay
                    
                    # Resolve Target Entity (Smart Resolution)
                    try:
                        entity = await resolve_tg_entity(client, group)
                        if not entity or (isinstance(entity, tuple) and entity[0] == "invite"):
                            # If it's an invite, campaign can't send unless joined
                            log_debug(f"BKG_TASK[{task_id}]: Mapping Error for {group}: Need to Join first.")
                            failed_list.append({"id": group, "name": group, "reason": "Not a Member"})
                            continue
                            
                        res_title = getattr(entity, 'title', str(group))
                        log_debug(f"BKG_TASK[{task_id}]: Target resolved -> {res_title}")
                    except Exception as e:
                        log_debug(f"BKG_TASK[{task_id}]: Mapping Error for {group}: {str(e)}")
                        failed_list.append({"id": group, "name": group, "reason": "Mapping Error"})
                        continue

                    # High-Fidelity Authorization Check
                    if not await client.is_user_authorized():
                        log_debug(f"BKG_TASK[{task_id}]: CRITICAL - Session expired for {phone_num}")
                        conn = get_db_connection()
                        conn.execute("UPDATE tasks SET status = 'failed' WHERE id = ?", (task_id,))
                        if hasattr(conn, "commit"): conn.commit()
                        if hasattr(conn, "close"): conn.close()
                        await client.disconnect()
                        active_tasks.remove(task_id)
                        return

                    # Personalization Merging & STRIP WHITESPACE (Fixes Code Block bug)
                    final_msg_base = str(message).strip()
                    
                    # Smart Variable Replacement
                    if hasattr(entity, 'title'): # It's a Group or Channel
                        final_msg_base = final_msg_base.replace('{{Group Name}}', getattr(entity, 'title', 'Our Group'))
                        final_msg_base = final_msg_base.replace('{{First Name}}', 'everyone').replace('{{Username}}', 'group')
                    else: # It's a User
                        f_name = getattr(entity, 'first_name', 'there')
                        u_name = getattr(entity, 'username', f_name)
                        final_msg_base = final_msg_base.replace('{{First Name}}', f_name)
                        final_msg_base = final_msg_base.replace('{{Username}}', f_name)
                        final_msg_base = final_msg_base.replace('{{Group Name}}', 'this chat')

                    # Final Spintax processing
                    final_msg = recursive_spin(final_msg_base).strip()
                    
                    # SPAM PREVENTION: Check last message
                    try:
                        last_msgs = await client.get_messages(entity, limit=1)
                        if last_msgs and last_msgs[0].sender_id == me_id:
                            log_debug(f"BKG_TASK[{task_id}]: Skipping {target_id} - Last message was from this account.")
                            continue
                    except Exception as e:
                        log_debug(f"BKG_TASK[{task_id}]: Last message check failed for {target_id}: {e}")

                    log_debug(f"BKG_TASK[{task_id}]: Sending to {target_id} via {sender_name}...")
                    
                    try:
                        await client.send_message(entity, final_msg, parse_mode='md') # Explicitly type as MD to avoid auto-code conversion
                        log_debug(f"BKG_TASK[{task_id}]: TRANSMITTED successfully.")
                        sent_ok_stats[0] += 1 # type: ignore
                        
                        # INSTANT COUNT UPDATE (Every message)
                        u_conn = get_db_connection()
                        u_conn.execute("UPDATE tasks SET sent_count = ? WHERE id = ?", (sent_ok_stats[0], task_id))
                        # INCREMENT USER GLOBAL DAILY COUNT
                        u_conn.execute("UPDATE users SET daily_campaign_count = daily_campaign_count + 1 WHERE id = ?", (u_id,))
                        if hasattr(u_conn, "commit"): u_conn.commit()
                        
                        # BATCH LOG UPDATE (Every 5 messages - prevents DB choking)
                        if sent_ok_stats[0] % 5 == 0:
                            u_conn.execute("UPDATE tasks SET failed_groups = ?, processed_groups = ? WHERE id = ?", (json.dumps(failed_list), json.dumps(processed_list), task_id))
                            if hasattr(u_conn, "commit"): u_conn.commit()
                        
                        if hasattr(u_conn, "close"): u_conn.close()
                            
                    except Exception as send_e:
                        err_str = str(send_e)
                        log_debug(f"BKG_TASK[{task_id}]: SEND ERROR to {target_id}: {err_str}")
                        reason = "Unknown Error"
                        if "ChatWriteForbidden" in err_str: reason = "Chat Restricted"
                        elif "PeerIdInvalid" in err_str: reason = "Peer ID Invalid"
                        elif "UserIsBlocked" in err_str: reason = "User Blocked"
                        elif "FloodWait" in err_str: reason = "Telegram Limit"
                        
                        failed_list.append({"id": group, "name": getattr(entity, 'title', group) if 'entity' in locals() else group, "reason": reason})

                    # Moderate Anti-Spam Interval
                    await asyncio.sleep(random.randint(15, 30))
                except Exception as group_err:
                    log_debug(f"BKG_TASK[{task_id}]: Loop error on group {raw_group}: {str(group_err)}")
                    if "FloodWaitError" in str(group_err): 
                        log_debug(f"BKG_TASK[{task_id}]: Flood detected. Aborting sequence.")
                        break
            
            # Final Batch Update (One Connection)
            conn = get_db_connection()
            # Double check if it was stopped externally before saving final state
            final_status_row = conn.execute("SELECT status FROM tasks WHERE id = ?", (task_id,)).fetchone()
            current_status = final_status_row["status"] if final_status_row else "processing"
            
            if current_status == "processing":
                # Check for interval_minutes or interval (hours)
                task_row = conn.execute("SELECT interval_hours, interval_minutes FROM tasks WHERE id = ?", (task_id,)).fetchone()
                val_hours = task_row["interval_hours"] if task_row else 0
                val_mins = task_row.get("interval_minutes", 0) if task_row else 0
                
                if val_hours > 0 or val_mins > 0:
                    delta = timedelta(hours=val_hours, minutes=val_mins)
                    new_time = (datetime.now(timezone.utc) + delta).strftime('%Y-%m-%dT%H:%M')
                    # RESET sent_count TO 0 for next batch cycle
                    conn.execute(
                        "UPDATE tasks SET status = 'pending', scheduled_time = ?, batch_number = batch_number + 1, sent_count = 0, failed_groups = '[]', processed_groups = '[]' WHERE id = ?", 
                        (new_time, task_id)
                    )
                    print(f"BKG: Task {task_id} rescheduled for {new_time} (Successful: {sent_ok_stats[0]})")
                else:
                    # Mark completion - User wants 'completed' even if some failed. 
                    final_status = 'completed'
                    log_debug(f"BKG_TASK[{task_id}]: Finalizing. Status={final_status}, Sent={sent_ok_stats[0]}, Failed={len(failed_list)}")
                    
                    conn.execute(
                        "UPDATE tasks SET status = ?, sent_count = ?, failed_groups = ?, processed_groups = ? WHERE id = ?",
                        (final_status, sent_ok_stats[0], json.dumps(failed_list), json.dumps(processed_list), task_id)
                    )
                    print(f"BKG: Task {task_id} marked {final_status.upper()} (Successful: {sent_ok_stats[0]})")
            else:
                log_debug(f"BKG: Task {task_id} already marked as {current_status}, skipping auto-complete.")
                # We still update the final stats so the UI is accurate
                conn.execute("UPDATE tasks SET sent_count = ?, failed_groups = ?, processed_groups = ? WHERE id = ?", (sent_ok_stats[0], json.dumps(failed_list), json.dumps(processed_list), task_id))
                
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
            
            # 1. Fetch PENDING tasks
            tasks = conn.execute(
                "SELECT id, message_text, target_groups, phone_number, user_id, interval_hours, scheduled_time, exclude_groups, processed_groups, sent_count, failed_groups FROM tasks WHERE status = 'pending' AND scheduled_time <= ?", 
                (now_str,)
            ).fetchall()
            
            if tasks:
                # 2. IMMEDIATELY MARK QUEUED (Hard Lock) to prevent double picking
                task_ids = [t[0] for t in tasks]
                placeholders = ",".join(["?"] * len(task_ids))
                conn.execute(f"UPDATE tasks SET status = 'queued' WHERE id IN ({placeholders})", tuple(task_ids))
                if hasattr(conn, "commit"): conn.commit()
                print(f"POLLER: Locked {len(tasks)} tasks for production.")

            if hasattr(conn, "close"): conn.close()
            
            # Heartbeat log
            if tasks:
                print(f"POLLER: Heartbeat - {now_str} | Launched tasks: {len(tasks)}")
            
            # 3. Launch loop
            for t in tasks:
                task_id = t[0]
                if task_id not in active_tasks:
                    active_tasks.add(task_id)
                    asyncio.create_task(run_single_task(*t))
                else:
                    print(f"POLLER: Task {task_id} is already in execution set. Checking lock.")

        except Exception as e:
            print(f"BKG: Poller major error: {e}")
        
        await asyncio.sleep(30) # Poll every 30 seconds

    print("CORE: System Ready.")

if __name__ == "__main__":
    import uvicorn  # type: ignore
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
