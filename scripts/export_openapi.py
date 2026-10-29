"""Scrie schema OpenAPI a aplicației pe stdout (sursa tipurilor TS din frontend/)."""

import json

from gym_control.app import create_app
from gym_control.settings import Settings

if __name__ == "__main__":
    app = create_app(Settings(database=":memory:"))
    print(json.dumps(app.openapi(), indent=2, ensure_ascii=False, sort_keys=True))
