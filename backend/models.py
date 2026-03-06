from typing import Optional, List
from pydantic import BaseModel

class Account(BaseModel):
    id: int
    phone_number: str
    session_string: str
    status: str # active, banned, pending

class Task(BaseModel):
    id: int
    account_id: int
    scheduled_time: str
    message_text: str
    target_groups: str
    status: str # pending, running, completed, failed
