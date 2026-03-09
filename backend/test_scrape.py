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
        # Check tgstat
        try:
            r = await client.get("https://tgstat.ru/en/search?q=iptv&page=1")
            soup = BeautifulSoup(r.text, "lxml")
            cards = soup.select("div.card[data-username], li.list-group-item, a[href*='/channel/'], a[href*='/group/']")
            print(f"TGSTAT: Status {r.status_code}, Found raw elements: {len(cards)}")
        except Exception as e:
            print(f"TGSTAT ERR: {e}")
            
        # Check tlgrm
        try:
            r = await client.get("https://tlgrm.eu/channels/iptv/1")
            soup = BeautifulSoup(r.text, "lxml")
            cards = soup.select("a[href*='t.me/'], a[href*='telegram.me/']")
            print(f"TLGRM: Status {r.status_code}, Found raw elements: {len(cards)}")
        except Exception as e:
            print(f"TLGRM ERR: {e}")
            
        # Check lyzem
        try:
            r = await client.get("https://lyzem.com/search?q=iptv")
            soup = BeautifulSoup(r.text, "lxml")
            cards = soup.select("a[href*='t.me/']")
            print(f"LYZEM: Status {r.status_code}, Found raw elements: {len(cards)}")
        except Exception as e:
            print(f"LYZEM ERR: {e}")

asyncio.run(check())
