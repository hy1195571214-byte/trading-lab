"""Run both local servers and clean up their child processes on exit."""
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
from dotenv import load_dotenv

root = Path(__file__).resolve().parents[1]
os.chdir(root)
load_dotenv(root / ".env")
load_dotenv(root / ".env.local", override=True)
node = shutil.which("node")
if not node:
    raise SystemExit("Node.js is required; run scripts/setup.sh after installing Node.js.")
commands = [
    [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", "backend",
     "--host", "127.0.0.1", "--port", "8000", "--reload", "--reload-dir", "backend/app"],
    [node, "frontend/node_modules/vite/bin/vite.js", "--config", "frontend/vite.config.ts",
     "--host", "127.0.0.1", "--port", "5173", "--strictPort", "frontend"],
]
children = []
stopping = False
exit_code = 0
runtime_env = os.environ.copy()
# The local launcher always uses SQLite, including when a shell inherited
# production configuration. The public gateway token has no local proxy peer.
runtime_env.pop("DATABASE_URL", None)
runtime_env.pop("TRADING_LAB_ORIGIN_TOKEN", None)
runtime_env["TRADING_LAB_ENV"] = "development"
local_dir = Path(runtime_env.get(
    "TRADING_LAB_LOCAL_DIR",
    str(Path.home() / "Library" / "Application Support" / "Trading Lab"),
)).expanduser().resolve()
local_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
database = Path(runtime_env.get("TRADING_LAB_DB", str(local_dir / "trading_lab.sqlite3"))).expanduser().resolve()
database.parent.mkdir(parents=True, exist_ok=True)
legacy_database = root / "backend" / "trading_lab.sqlite3"
if not database.exists() and legacy_database.exists():
    # SQLite backup includes committed WAL contents. Publish only a complete copy.
    fd, temporary = tempfile.mkstemp(prefix=".database-", suffix=".sqlite3", dir=database.parent)
    os.close(fd)
    try:
        with sqlite3.connect(legacy_database.as_uri() + "?mode=ro", uri=True) as source:
            with sqlite3.connect(temporary) as destination:
                source.backup(destination)
        os.replace(temporary, database)
    finally:
        Path(temporary).unlink(missing_ok=True)
runtime_env["TRADING_LAB_DB"] = str(database)
for variable, filename in (
    ("TRADING_LAB_SECRET_FILE", "secrets.json"),
    ("TRADING_LAB_MARKET_KEY_FILE", "market-data.key"),
):
    destination = Path(runtime_env.get(variable, str(local_dir / filename))).expanduser().resolve()
    legacy = root / "backend" / "data" / filename
    if not destination.exists() and legacy.is_file():
        content = legacy.read_bytes()
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as stream:
            destination.chmod(0o600)
            stream.write(content)
    runtime_env[variable] = str(destination)
# Cloud-synced folders can miss native file notifications.
runtime_env.setdefault("WATCHFILES_FORCE_POLLING", "true")

def stop(*_):
    global stopping
    stopping = True

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
try:
    for command in commands:
        children.append(subprocess.Popen(command, start_new_session=True, env=runtime_env))
    print("Trading Lab: http://127.0.0.1:5173  (Ctrl+C stops both servers)", flush=True)
    print(f"Local database: {database}", flush=True)
    while not stopping and all(child.poll() is None for child in children):
        time.sleep(0.25)
    if not stopping:
        exit_code = next((child.returncode for child in children if child.returncode), 1)
finally:
    for child in children:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for child in children:
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()

sys.exit(exit_code)
