import asyncio
import httpx
from bs4 import BeautifulSoup
import re

SCRAPER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

async def check():
    async with httpx.AsyncClient(headers=SCRAPER_HEADERS, timeout=15) as client:
        # Check telegram-group.com
        try:
            r = await client.get("https://telegram-group.com/en/search?q=iptv")
            soup = BeautifulSoup(r.text, "lxml")
            cards = soup.select("a[href*='t.me/'], a[href*='/group/']")
            print(f"TG-GROUP: Status {r.status_code}, Found raw elements: {len(cards)}")
        except Exception as e:
            print(f"TG-GROUP ERR: {e}")
            
        # Check telemetrio
        try:
            r = await client.get("https://telemetr.io/en/channels?search=iptv")
            soup = BeautifulSoup(r.text, "lxml")
            cards = soup.select("a[href*='t.me/'], a[href*='/en/channels/']")
            print(f"TELEMETR: Status {r.status_code}, Found raw elements: {len(cards)}")
        except Exception as e:
            print(f"TELEMETR ERR: {e}")

asyncio.run(check())
