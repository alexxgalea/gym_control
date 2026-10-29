"""Orele se stochează în UTC; afișarea în ora locală (Settings.timezone) se face doar aici."""

from datetime import date, datetime, timezone
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


class InvalidLocalTime(ValueError):
    """Dată/oră locală lipsă sau invalidă; mesajul e în română."""


_LOCAL_FORMATS = ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S")


def parse_local(raw: str, name: str, tz: str,
                error: type[ValueError] = InvalidLocalTime) -> datetime:
    """Parsează o dată/oră locală (`AAAA-LL-ZZTHH:MM` sau `AAAA-LL-ZZ HH:MM`) în UTC.

    `error`: clasa excepției ridicate (apelantul își păstrează propriul tip, ex. `InvalidInterval`)."""
    raw = (raw or "").strip()
    if not raw:
        raise error(f"Completează data și ora pentru „{name}”.")
    for fmt in _LOCAL_FORMATS:
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)
        except ValueError:
            continue
    raise error(f"Data și ora pentru „{name}” sunt invalide. Folosește formatul AAAA-LL-ZZ HH:MM.")
