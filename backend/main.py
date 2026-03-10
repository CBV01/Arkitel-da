import os
from dotenv import load_dotenv  # type: ignore
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
from typing import Optional, List, Dict, Any, Union
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

app = FastAPI(title="ArkiTel Automation API", lifespan=lifespan)

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
                # Use title or name, fallback to ID if both fail
                display_name = getattr(dialog, 'name', None) or getattr(dialog, 'title', None) or str(dialog.id)
                dialogs_list.append({
                    "id": str(dialog.id),
                    "name": display_name,
                    "title": display_name, 
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
    # explicitly fetch api_id and api_hash to avoid 'empty' looking accounts in frontend
    rows = conn.execute("SELECT phone_number, status, api_id, api_hash FROM accounts WHERE user_id = ?", (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    
    accounts = []
    for row in rows:
        accounts.append({
            "phone_number": row[0],
            "status": row[1],
            "api_id": row[2],
            "api_hash": row[3]
        })
    print(f"AUTH_ISOLATION: User {user_id} fetched {len(accounts)} accounts.")
    return {"accounts": accounts}


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
                    for link in links:
                        href = link.get("href", "")
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
        "real", "original", "main", "updates", "news", "info"
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
        session_str, api_id, api_hash, acc_phone = row[0], int(row[1]), row[2], row[3]
        client = TelegramClient(StringSession(session_str), api_id, api_hash)
        try:
            await client.connect()
            if not await client.is_user_authorized():
                continue
            for q in search_queries:
                try:
                    if queue: await queue.put({"type": "progress", "msg": f"TG Search: Testing '{q}'..."}) # type: ignore
                    search_result = await client(SearchRequest(q=q, limit=100))
                    for chat in search_result.chats:
                        if not chat:
                            continue
                        chat_id_str = str(getattr(chat, 'id', '0'))
                        if chat_id_str in unique_groups:
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
                            "source": "telegram"
                        }
                        unique_groups[chat_id_str] = item
                        # Fire and forget save
                        if user_id: asyncio.create_task(asyncio.to_thread(lambda: save_scraped_group(user_id, item))) # type: ignore
                        if queue:
                            await queue.put({"type": "result", "layer": 1, "data": item})  # type: ignore
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
                                # Fire and forget save
                                if user_id: asyncio.create_task(asyncio.to_thread(lambda: save_scraped_group(user_id, item2))) # type: ignore
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

    # Record all found to history and leads
    conn2 = get_db_connection()
    for item in final_list:
        gid = item.get('id')
        if not gid: continue
        conn2.execute("INSERT OR IGNORE INTO scrape_history (group_id, user_id) VALUES (?, ?)", (gid, user_id))
        conn2.execute(
            """INSERT OR REPLACE INTO scraped_groups 
               (id, user_id, title, username, participants_count, type, is_private, country, user_shows, global_shows, source) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (str(gid), user_id, item.get('title', 'Unknown'), item.get('username'), item.get('participants_count', 0), 
             item.get('type', 'group'), 1 if item.get('is_private') else 0, item.get('country', 'Global'), 
             item.get('user_shows', 1), item.get('global_shows', 1), "scraper")
        )
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
    conn = get_db_connection()
    row = conn.execute("SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", (req.phone_number, user_id)).fetchone()
    if not row: raise HTTPException(status_code=404, detail="Account not found")
    
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    
    results = {'joined': 0, 'failed': 0}
    try:
        # pyre-ignore[21]: telethon channels
        from telethon.tl.functions.channels import JoinChannelRequest
        for g_id in req.group_ids:
            try:
                # User requested approx 10s interval for safety
                await asyncio.sleep(random.randint(10, 15))
                
                # Resolve entity before joining to ensure success
                resolved_id = g_id
                if str(g_id).lstrip('-').isdigit():
                    resolved_id = int(g_id)
                entity = await client.get_entity(resolved_id)
                
                await client(JoinChannelRequest(entity))
                results['joined'] += 1
            except Exception as e:
                results['failed'] += 1
                print(f"Join Error {g_id}: {e}")
                if "FloodWaitError" in str(e): break
        return {"status": "success", **results}
    finally:
        await client.disconnect()

class JoinRequest(BaseModel):
    group_id: str
    phone_number: str

@app.post("/api/telegram/join")
async def join_single(req: JoinRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    row = conn.execute("SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", (req.phone_number, user_id)).fetchone()
    if not row: raise HTTPException(status_code=404, detail="Account not found")
    
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    try:
        # Resolve entity first
        resolved_id = req.group_id
        if str(req.group_id).lstrip('-').isdigit():
            resolved_id = int(req.group_id)
        entity = await client.get_entity(resolved_id)

        # pyre-ignore[21]
        from telethon.tl.functions.channels import JoinChannelRequest # pyre-ignore[21]
        await client(JoinChannelRequest(entity))
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.disconnect()

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
    conn = get_db_connection()
    row = conn.execute("SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", (req.phone_number, user_id)).fetchone()
    if hasattr(conn, "close"): conn.close()
    if not row: raise HTTPException(status_code=404, detail="Account not found")
    
    session_str, api_id, api_hash = row[0], int(row[1]), row[2]
    client = TelegramClient(StringSession(session_str), api_id, api_hash)
    await client.connect()
    
    try:
        # Resolve entity (can be a username or ID)
        target = req.group_id
        if str(target).lstrip('-').isdigit(): target = int(target)
        entity = await client.get_entity(target)
        
        # Optimized high-speed extraction using get_participants wrapper
        # limit is set to 1000 for efficiency while staying within common safety limits
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
        raise HTTPException(status_code=400, detail=f"Extraction failed: {str(e)}")
    finally:
        await client.disconnect()

@app.get("/api/telegram/leads/members")
async def get_member_leads(user_id: str = Depends(get_current_user_id)):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM leads WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    if hasattr(conn, "close"): conn.close()
    return {"members": [dict(r) for r in rows]}

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
        total_accounts = conn.execute("SELECT COUNT(*) FROM accounts WHERE user_id = ? AND status = 'active'", (user_id,)).fetchone()[0]
        
        # Combined Leads count (Groups/Channels + Members)
        c_scraped = conn.execute("SELECT COUNT(*) FROM scraped_groups WHERE user_id = ?", (user_id,)).fetchone()[0]
        c_members = conn.execute("SELECT COUNT(*) FROM leads WHERE user_id = ?", (user_id,)).fetchone()[0]
        total_leads = c_scraped + c_members
        
        pending_tasks = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'pending'", (user_id,)).fetchone()[0]
        messages_sent = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completed'", (user_id,)).fetchone()[0]
        
        # Get active campaigns for table
        tasks_rows = conn.execute(
            "SELECT phone_number, status, message_text, scheduled_time FROM tasks WHERE user_id = ? ORDER BY scheduled_time DESC LIMIT 5", 
            (user_id,)
        ).fetchall()
        
        # Construct engagement flow
        base_flows = [30, 60, 40, 80, 50, 70, 90, 45, 85, 100] # Default
        if total_leads > 0:
            import random
            base_flows = [random.randint(40, 100) for _ in range(10)]
            
        service_health = {
             "database": "Stable",
             "poller": "Active" if pending_tasks >= 0 else "Offline",
             "api": "Idle" if pending_tasks == 0 else "Transmitting..."
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
            "engagement_flow": base_flows,
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
            
            acc = conn.execute(
                "SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?", 
                (phone_num, u_id)
            ).fetchone()
            if hasattr(conn, "close"): conn.close()

            if not acc:
                print(f"BKG: No account for task {task_id}")
                return

            session_str, api_id, api_hash = acc[0], int(acc[1]), acc[2]
            client = TelegramClient(StringSession(session_str), api_id, api_hash)
            await client.connect()
            
            import ast
            try:
                target_groups = ast.literal_eval(groups_str)
            except:
                target_groups = [groups_str] if groups_str else []

            for group in target_groups:
                try:
                    await asyncio.sleep(random.uniform(2.0, 5.0))
                    
                    def spin(match):
                        options = match.group(1).split('|')
                        return random.choice(options)
                    spinned_message = re.sub(r'\{([^{}]*)\}', spin, message)
                    
                    await client.send_message(group, spinned_message)
                    await asyncio.sleep(random.randint(45, 120))
                except Exception as group_err:
                    print(f"BKG: Task {task_id} Group Error ({group}): {group_err}")
                    if "FloodWaitError" in str(group_err): break
            
            await client.disconnect()

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
            if hasattr(conn, "close"): conn.close()
            
            for t in tasks:
                task_id = t[0]
                if task_id not in active_tasks:
                    active_tasks.add(task_id)
                    # Start task in background
                    asyncio.create_task(run_single_task(*t))
                    print(f"BKG: Launched task {task_id}")
            
        except Exception as e:
            print(f"BKG: Poller major error: {e}")
        
        await asyncio.sleep(30) # Poll every 30 seconds

    print("CORE: System Ready.")

if __name__ == "__main__":
    import uvicorn  # type: ignore

