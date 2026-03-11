import os
import hashlib
import binascii
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt  # type: ignore
from fastapi import Depends, HTTPException, status, Request  # type: ignore
from fastapi.security import OAuth2PasswordBearer  # type: ignore

# Configuration
SECRET_KEY = os.getenv("JWT_SECRET", "super-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 1 week

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

def hash_password(password: str) -> str:
# ... (rest of the file stays same)
    """Hash a password for storing."""
    salt = hashlib.sha256(os.urandom(60)).hexdigest().encode('ascii')
    pwdhash = hashlib.pbkdf2_hmac('sha512', password.encode('utf-8'), 
                                salt, 100000)
    pwdhash = binascii.hexlify(pwdhash)
    return (salt + pwdhash).decode('ascii')

def verify_password(plain_password: str, stored_password: str) -> bool:
    """Verify a stored password against one provided by user."""
    pwd_str = str(stored_password)
    if len(pwd_str) < 66:  # Minimal length for salt + hash
        return False
    try:
        # Encode to bytes first, then slice. This is safer for some IDE type checkers.
        full_bytes = pwd_str.encode('ascii')
        salt_bytes = full_bytes[0:64]  # type: ignore
        stored_hash_bytes = full_bytes[64:]  # type: ignore
        pwdhash = hashlib.pbkdf2_hmac('sha512', 
                                    plain_password.encode('utf-8'), 
                                    salt_bytes, 100000)
        pwdhash = binascii.hexlify(pwdhash)
        return pwdhash == stored_hash_bytes
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    return hash_password(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

from fastapi import Depends, HTTPException, status, Request  # type: ignore

# ... (other imports)

async def get_current_user_id(request: Request, token: Optional[str] = Depends(oauth2_scheme)):
    """
    Smarter auth that checks both Bearer header AND ?token= query parameter.
    Required for SSE/EventSource which doesn't support custom headers.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Priority: 1. Header (token arg from oauth2_scheme) 2. Query Parameter
    final_token = token
    if not final_token:
        final_token = request.query_params.get("token")
        
    if not final_token:
        raise credentials_exception

    try:
        payload = jwt.decode(str(final_token), SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        return str(user_id)
    except JWTError as e:
        print(f"DEBUG_AUTH: JWTError - {str(e)}")
        raise credentials_exception
    except Exception as e:
        print(f"DEBUG_AUTH: Unexpected Error - {str(e)}")
        raise credentials_exception
