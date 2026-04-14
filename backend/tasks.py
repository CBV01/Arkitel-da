"""
tasks.py - Background Task Execution Module

This module contains the task execution logic for the Telegram Automation Platform.
The tasks are executed by the async poller in main.py, not Celery.

Celery was considered but the async/await approach with FastAPI's lifespan
was chosen for simpler deployment on Hugging Face Spaces.
"""

import asyncio
import random
import json
import re
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, cast

# Telethon imports for message sending
from telethon.sync import TelegramClient  # type: ignore
from telethon.sessions import StringSession  # type: ignore
from telethon.errors import FloodWaitError, ChannelPrivateError, UserDeactivatedError  # type: ignore

from database import get_db_connection


async def send_message_with_retry(
    client: TelegramClient,
    entity: Any,
    message: str,
    max_retries: int = 3
) -> bool:
    """
    Send a message to a group/channel with retry logic for FloodWait errors.

    Args:
        client: The TelegramClient instance
        entity: The target entity (group/channel)
        message: The message text to send
        max_retries: Maximum number of retry attempts

    Returns:
        True if message was sent successfully, False otherwise
    """
    for attempt in range(max_retries):
        try:
            await client.send_message(entity, message)
            return True
        except FloodWaitError as e:
            wait_time = e.seconds
            if wait_time > 3600:  # If wait time is over an hour, give up
                print(f"SEND_ERROR: FloodWait too long ({wait_time}s), aborting")
                return False
            print(f"SEND_WARNING: FloodWait detected, waiting {wait_time}s before retry {attempt + 1}/{max_retries}")
            await asyncio.sleep(wait_time)
        except ChannelPrivateError:
            print(f"SEND_ERROR: Channel/Group is private or inaccessible")
            return False
        except UserDeactivatedError:
            print(f"SEND_ERROR: Account has been deactivated/banned")
            return False
        except Exception as e:
            print(f"SEND_ERROR: Unexpected error: {e}")
            if attempt == max_retries - 1:
                return False

    return False


async def process_campaign_task(task_id: int) -> Dict[str, Any]:
    """
    Process a single campaign task from the database.

    This is the main task execution function called by the poller in main.py.
    It handles:
    1. Fetching task details from database
    2. Loading the Telegram account session
    3. Sending messages to target groups with anti-ban delays
    4. Tracking progress and failures
    5. Handling interval-based recurring campaigns

    Args:
        task_id: The database ID of the task to process

    Returns:
        Dict with execution results:
        - success: bool
        - sent_count: int (messages sent in this run)
        - failed_count: int
        - failed_groups: list of dicts with group name and error reason
        - next_run: Optional datetime for recurring tasks
    """
    conn = get_db_connection()
    result = {
        "success": False,
        "sent_count": 0,
        "failed_count": 0,
        "failed_groups": [],
        "next_run": None
    }

    try:
        # Fetch task details
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()

        if not task:
            print(f"TASK_ERROR: Task {task_id} not found in database")
            return result

        task_id = task["id"]
        user_id = task["user_id"]
        phone_number = task["phone_number"]
        message_text = task["message_text"]
        target_groups_str = task["target_groups"]
        status = task["status"]
        interval_hours = task["interval_hours"] or 0
        interval_minutes = task["interval_minutes"] or 0
        sent_count = task["sent_count"] or 0
        batch_number = task["batch_number"] or 1
        failed_groups_str = task["failed_groups"] or "[]"
        exclude_groups_str = task["exclude_groups"] or "[]"
        processed_groups_str = task.get("processed_groups") or "[]"

        # Check if task should be processed
        if status not in ["pending", "paused"]:
            print(f"TASK_SKIP: Task {task_id} has status '{status}', skipping")
            return result

        if status == "paused":
            print(f"TASK_PAUSED: Task {task_id} is paused")
            return result

        # Parse group lists
        try:
            target_groups = json.loads(target_groups_str.replace("'", '"'))
        except (json.JSONDecodeError, SyntaxError) as e:
            print(f"TASK_PARSE_ERROR: target_groups for task {task_id}: {e}")
            target_groups = eval(target_groups_str) if target_groups_str else []

        try:
            failed_groups = json.loads(failed_groups_str.replace("'", '"'))
        except (json.JSONDecodeError, SyntaxError) as e:
            print(f"TASK_PARSE_ERROR: failed_groups for task {task_id}: {e}")
            failed_groups = []

        try:
            exclude_groups = json.loads(exclude_groups_str.replace("'", '"'))
        except (json.JSONDecodeError, SyntaxError) as e:
            print(f"TASK_PARSE_ERROR: exclude_groups for task {task_id}: {e}")
            exclude_groups = []

        try:
            processed_groups = json.loads(processed_groups_str.replace("'", '"'))
        except (json.JSONDecodeError, SyntaxError) as e:
            print(f"TASK_PARSE_ERROR: processed_groups for task {task_id}: {e}")
            processed_groups = []

        # Filter out excluded and already processed groups
        groups_to_process = [
            g for g in target_groups
            if g not in exclude_groups and g not in processed_groups
        ]

        if not groups_to_process:
            print(f"TASK_COMPLETE: Task {task_id} - all groups processed")
            # Mark as completed if no more groups to process
            conn.execute(
                "UPDATE tasks SET status = 'completed' WHERE id = ?",
                (task_id,)
            )
            if hasattr(conn, "commit"):
                conn.commit()
            result["success"] = True
            return result

        # Get account session
        account = conn.execute(
            "SELECT session_string, api_id, api_hash FROM accounts WHERE phone_number = ? AND user_id = ?",
            (phone_number, user_id)
        ).fetchone()

        if not account:
            print(f"TASK_ERROR: Account {phone_number} not found for user {user_id}")
            conn.execute(
                "UPDATE tasks SET status = 'failed' WHERE id = ?",
                (task_id,)
            )
            if hasattr(conn, "commit"):
                conn.commit()
            return result

        session_str = account["session_string"]
        api_id = int(account["api_id"])
        api_hash = account["api_hash"]

        # Connect to Telegram
        client = TelegramClient(StringSession(session_str), api_id, api_hash)
        await client.connect()

        if not await client.is_user_authorized():
            print(f"TASK_AUTH_ERROR: Account {phone_number} is not authorized")
            await client.disconnect()
            conn.execute(
                "UPDATE tasks SET status = 'failed', status_detail = 'Session expired' WHERE id = ?",
                (task_id,)
            )
            if hasattr(conn, "commit"):
                conn.commit()
            return result

        print(f"TASK_START: Processing task {task_id} for account {phone_number}, {len(groups_to_process)} groups to process")

        # Process each group
        groups_sent = 0
        groups_failed_this_run = []

        for i, group_id in enumerate(groups_to_process):
            try:
                # Anti-ban delay between messages (30-120 seconds randomized)
                if i > 0:  # Don't delay before first message
                    delay = random.randint(30, 120)
                    print(f"ANTI_BAN: Waiting {delay}s before next message...")
                    await asyncio.sleep(delay)

                # Resolve and join group if needed
                try:
                    entity = await resolve_and_join(client, group_id, user_id, phone_number)
                except Exception as e:
                    print(f"JOIN_ERROR: Could not resolve/join {group_id}: {e}")
                    groups_failed_this_run.append({"name": group_id, "reason": f"Join failed: {str(e)}"})
                    result["failed_count"] += 1
                    continue

                # Send message
                success = await send_message_with_retry(client, entity, message_text)

                if success:
                    groups_sent += 1
                    result["sent_count"] += 1
                    processed_groups.append(group_id)
                    print(f"MESSAGE_SENT: {i + 1}/{len(groups_to_process)} to {group_id}")
                else:
                    groups_failed_this_run.append({"name": group_id, "reason": "Message send failed"})
                    result["failed_count"] += 1

            except FloodWaitError as e:
                wait_time = e.seconds
                print(f"FLOOD_WAIT: Task {task_id} must wait {wait_time}s")
                groups_failed_this_run.append({"name": group_id, "reason": f"FloodWait: {wait_time}s required"})
                result["failed_count"] += 1
                # Continue to next group instead of stopping entirely

            except Exception as e:
                print(f"GROUP_ERROR: Failed to process {group_id}: {e}")
                groups_failed_this_run.append({"name": group_id, "reason": str(e)})
                result["failed_count"] += 1

        # Update database with progress
        new_sent_count = sent_count + groups_sent
        failed_groups.extend(groups_failed_this_run)

        conn.execute(
            """UPDATE tasks SET
               sent_count = ?,
               batch_number = ?,
               failed_groups = ?,
               processed_groups = ?,
               status = ?
               WHERE id = ?""",
            (new_sent_count, batch_number, json.dumps(failed_groups), json.dumps(processed_groups), "processing", task_id)
        )

        # Check if all groups are processed
        if len(processed_groups) >= len(target_groups):
            # All groups done - check if recurring
            if interval_hours > 0 or interval_minutes > 0:
                # Schedule next run
                next_run = calculate_next_run(interval_hours, interval_minutes)
                result["next_run"] = next_run

                # Reset for next batch
                conn.execute(
                    """UPDATE tasks SET
                       status = 'pending',
                       scheduled_time = ?,
                       sent_count = 0,
                       batch_number = ?,
                       failed_groups = '[]',
                       processed_groups = '[]'
                       WHERE id = ?""",
                    (next_run.strftime('%Y-%m-%dT%H:%M'), batch_number + 1, task_id)
                )
                print(f"TASK_RECURRING: Task {task_id} rescheduled for {next_run}")
            else:
                conn.execute("UPDATE tasks SET status = 'completed' WHERE id = ?", (task_id,))
                print(f"TASK_COMPLETE: Task {task_id} finished successfully")
        else:
            print(f"TASK_PROGRESS: Task {task_id} - {groups_sent} sent, {result['failed_count']} failed, more groups remaining")

        if hasattr(conn, "commit"):
            conn.commit()

        result["success"] = True
        await client.disconnect()

    except Exception as e:
        print(f"TASK_FATAL_ERROR: Task {task_id} failed with: {e}")
        import traceback
        traceback.print_exc()

        try:
            conn.execute(
                "UPDATE tasks SET status = 'failed', status_detail = ? WHERE id = ?",
                (str(e), task_id)
            )
            if hasattr(conn, "commit"):
                conn.commit()
        except sqlite3.Error as db_e:
            print(f"TASK_DB_ERROR: Failed to update task status after fatal error: {db_e}")
    finally:
        if hasattr(conn, "close"):
            conn.close()

    return result


async def resolve_and_join(
    client: TelegramClient,
    target: str,
    user_id: str,
    phone_number: str
) -> Any:
    """
    Resolve a group identifier and join if not already a member.

    Args:
        client: TelegramClient instance
        target: Group ID, username, or invite link
        user_id: User ID for recording joins
        phone_number: Phone number for recording joins

    Returns:
        The resolved entity object
    """
    from telethon.tl.functions.channels import JoinChannelRequest  # type: ignore
    from telethon.tl.functions.messages import ImportChatInviteRequest  # type: ignore

    target_str = str(target).strip()

    # Handle numeric IDs
    if target_str.lstrip('-').isdigit():
        entity = await client.get_entity(int(target_str))
    # Handle invite links
    elif "t.me/" in target_str or "telegram.me/" in target_str:
        if "joinchat/" in target_str or "/+" in target_str:
            hash_val = target_str.split('/')[-1].replace('+', '')
            await client(ImportChatInviteRequest(hash_val))
            entity = await client.get_entity(hash_val)
        else:
            username = target_str.split('/')[-1].lstrip('@')
            entity = await client.get_entity(username)
    # Handle usernames
    else:
        username = target_str.lstrip('@')
        entity = await client.get_entity(username)

    # Join if not already a member
    try:
        if getattr(entity, 'left', False):
            await client(JoinChannelRequest(entity))
    except Exception as e:
        print(f"JOIN_WARNING: Could not join {target_str}: {e}")

    # Record the join
    try:
        conn = get_db_connection()
        conn.execute(
            "INSERT OR IGNORE INTO account_joins (user_id, phone_number, group_id) VALUES (?, ?, ?)",
            (user_id, phone_number, target_str)
        )
        if hasattr(conn, "commit"):
            conn.commit()
        if hasattr(conn, "close"):
            conn.close()
    except Exception as e:
        print(f"DB_JOIN_ERROR: Failed to record join: {e}")

    return entity


def calculate_next_run(interval_hours: int, interval_minutes: int) -> datetime:
    """
    Calculate the next scheduled run time based on interval.

    Args:
        interval_hours: Hours between runs
        interval_minutes: Additional minutes between runs

    Returns:
        datetime for next run
    """
    now = datetime.now(timezone.utc)
    delta = timedelta(hours=interval_hours, minutes=interval_minutes)
    return now + delta


# Legacy stub - kept for backwards compatibility
# The actual task execution is handled by the async poller in main.py
def process_batch_send_legacy(task_id: int):
    """
    Legacy synchronous task processor (deprecated).
    Use process_campaign_task() instead.
    """
    print(f"LEGACY_WARNING: process_batch_send called for task {task_id}, but async poller should be used")
    # This is a stub - actual implementation is in process_campaign_task()
