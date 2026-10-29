import os
from dataclasses import dataclass
from datetime import time


@dataclass(frozen=True)
class Settings:
    """Configurația Sălii; injectabilă din exterior (testele o dau direct)."""

    database: str = "gym_control.db"
    hall_subnet: str = "192.168.10.0/24"
    opening_time: time = time(6, 0)
    closing_time: time = time(22, 0)
    retention_months: int = 12
    # Primul Admin: creat la pornire dacă nu există (vezi README).
    bootstrap_admin_username: str = ""
    bootstrap_admin_password: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        return cls(
            database=env.get("GYM_DATABASE", cls.database),
            hall_subnet=env.get("GYM_HALL_SUBNET", cls.hall_subnet),
            opening_time=time.fromisoformat(env.get("GYM_OPENING_TIME", "06:00")),
            closing_time=time.fromisoformat(env.get("GYM_CLOSING_TIME", "22:00")),
            retention_months=int(env.get("GYM_RETENTION_MONTHS", "12")),
            bootstrap_admin_username=env.get("GYM_ADMIN_USER", ""),
            bootstrap_admin_password=env.get("GYM_ADMIN_PASSWORD", ""),
        )
