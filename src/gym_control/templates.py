from pathlib import Path

from fastapi.templating import Jinja2Templates

from gym_control.clocktime import local_hm, local_iso

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.filters["local_hm"] = local_hm
templates.env.filters["local_iso"] = local_iso
