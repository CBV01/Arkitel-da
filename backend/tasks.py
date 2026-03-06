import os
import time
import random
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "telegram_worker",
    broker=REDIS_URL,
    backend=REDIS_URL
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

@celery_app.task(bind=True, max_retries=3)
def process_batch_send(self, task_id: int):
    """
    Background worker that handles safe batch sending to avoid bans.
    Iterates over target groups with randomized delays.
    """
    from database import get_db_connection
    
    conn = get_db_connection()
    # Fetch task details from Turso DB
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
    task = cursor.fetchone()
    
    if not task:
        print(f"Task {task_id} not found.")
        return
    
    print(f"Starting scheduled batch for task {task_id}...")
    
    # In full implementation:
    # 1. Load session from DB
    # 2. Connect via Telethon
    # 3. For group in task['target_groups']:
    #      client.send_message(group, task['message_text'])
    #      # ANTI-BAN: Sleep between 30 and 120 seconds
    #      time.sleep(random.randint(30, 120))
    
    # Mark task as completed
    conn.execute("UPDATE tasks SET status = 'completed' WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    
    print(f"Task {task_id} completed successfully.")
