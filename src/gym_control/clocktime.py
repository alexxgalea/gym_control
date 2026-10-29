"""Orele se stochează în UTC; afișarea în ora locală (Settings.timezone) se face doar aici."""

from datetime import date, datetime
from zoneinfo import ZoneInfo


def to_local(value: datetime | str, tz: str) -> datetime:
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.astimezone(ZoneInfo(tz))


def local_hm(value: datetime | str, tz: str) -> str:
    return to_local(value, tz).strftime("%H:%M")


def local_iso(value: datetime | str, tz: str) -> str:
    return to_local(value, tz).strftime("%Y-%m-%d %H:%M")


def local_day(value: datetime | str, tz: str) -> date:
    return to_local(value, tz).date()
