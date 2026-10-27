"""Run both local servers and clean up their child processes on exit."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
from dotenv import load_dotenv

root = Path(__file__).resolve().parents[1]
os.chdir(root)
load_dotenv(root / ".env")
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
runtime_env = os.environ.copy()
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
    while not stopping and all(child.poll() is None for child in children):
        time.sleep(0.25)
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
