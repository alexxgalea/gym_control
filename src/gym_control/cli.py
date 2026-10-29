"""CLI de administrare: `python -m gym_control.cli create-admin <cont>`."""

import argparse
import getpass
import sqlite3
import sys

from gym_control import auth, db
from gym_control.app import utc_now
from gym_control.settings import Settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gym_control.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-admin", help="creează un cont de Admin")
    p.add_argument("username")
    p.add_argument("--password", help="dacă lipsește, se cere de la tastatură")
    args = parser.parse_args(argv)

    password = args.password or getpass.getpass("Parolă: ")
    if len(password) < 8:
        print("Parola trebuie să aibă cel puțin 8 caractere.", file=sys.stderr)
        return 1
    conn = db.connect(Settings.from_env().database)
    try:
        auth.create_admin(conn, utc_now(), args.username, password)
    except sqlite3.IntegrityError:
        print(f"Contul „{args.username}” există deja.", file=sys.stderr)
        return 1
    print(f"Admin „{args.username}” creat.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
