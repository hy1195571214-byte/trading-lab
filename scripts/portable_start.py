"""Start the unpacked Trading Lab demo and its local database."""

import argparse
from contextlib import ExitStack
import hashlib
from ipaddress import IPv4Address, IPv4Network
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import venv


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RUNTIME = ROOT / ".runtime"
REQUIREMENTS = ROOT / "requirements.txt"
PRIVATE_NETWORKS = tuple(
    IPv4Network(cidr) for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def run_in_environment():
    environment = RUNTIME / "venv"
    if Path(sys.prefix).resolve() == environment:
        return
    executable = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    ready = environment / "trading-lab-version"
    digest = hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
    version = f"{sys.version_info.major}.{sys.version_info.minor} {digest}\n"
    if not executable.is_file() or not ready.is_file() or ready.read_text() != version:
        venv.EnvBuilder(with_pip=True).create(environment)
        pip = [str(executable), "-m", "pip", "--isolated", "install",
               "--disable-pip-version-check", "--no-cache-dir", "--only-binary=:all:",
               "-r", str(REQUIREMENTS)]
        wheelhouse = ROOT / "wheelhouse"
        if not wheelhouse.is_dir() or subprocess.call(
            [*pip, "--no-index", "--find-links", str(wheelhouse)]
        ) != 0:
            print("此环境缺少离线依赖，正在尝试从 PyPI 安装。", flush=True)
            subprocess.run([*pip, "--index-url", "https://pypi.org/simple"], check=True)
        ready.write_text(version)
    command = [str(executable), str(Path(__file__).resolve()), *sys.argv[1:]]
    if os.name != "nt":
        os.execv(command[0], command)
    try:
        raise SystemExit(subprocess.call(command))
    except KeyboardInterrupt:
        raise SystemExit(130) from None


def configure_workspace(lan_host):
    database = DATA / "trading_lab.sqlite3"
    if not database.is_file() or not (ROOT / "frontend/index.html").is_file():
        raise SystemExit("运行包缺少数据库或网页文件，请重新完整解压。")
    for name in ("DATABASE_URL", "TRADING_LAB_ORIGIN_TOKEN", "TRADING_LAB_API_KEY",
                 "TRADING_LAB_ENCRYPTION_KEY", "TRADING_LAB_WORKSPACE_PASSWORD",
                 "TRADING_LAB_SESSION_SECRET"):
        os.environ.pop(name, None)
    os.environ.update({
        "TRADING_LAB_ENV": "demo",
        "TRADING_LAB_DB": str(database),
        "TRADING_LAB_SECRET_FILE": str(RUNTIME / "model-secret.json"),
        "TRADING_LAB_MARKET_KEY_FILE": str(RUNTIME / "market-data.key"),
        "TRADING_LAB_ALLOWED_ORIGINS": "",
    })
    if lan_host:
        password_file = RUNTIME / "demo-password.txt"
        try:
            fd = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(secrets.token_urlsafe(18) + "\n")
        password = password_file.read_text(encoding="utf-8").strip()
        if len(password) < 12:
            raise SystemExit("局域网演示密码至少需要 12 个字符，请检查 .runtime/demo-password.txt。")
        os.environ["TRADING_LAB_WORKSPACE_PASSWORD"] = password
        os.environ["TRADING_LAB_SESSION_SECRET"] = secrets.token_urlsafe(32)
        print(f"局域网登录密码保存在 {password_file}", flush=True)


def serve(lan_host, port):
    from fastapi.staticfiles import StaticFiles
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    from starlette.responses import PlainTextResponse
    import uvicorn

    sys.path.insert(0, str(ROOT / "backend"))
    from app.main import app

    if lan_host:
        @app.middleware("http")
        async def restrict_to_local_network(request, call_next):
            try:
                address = IPv4Address(request.client.host) if request.client else None
            except ValueError:
                address = None
            if address is None or not (
                address.is_loopback or any(address in network for network in PRIVATE_NETWORKS)
            ):
                return PlainTextResponse("Local network access only", status_code=403)
            return await call_next(request)
    if lan_host != "0.0.0.0":
        allowed_hosts = ["localhost", "127.0.0.1"]
        if lan_host:
            allowed_hosts.append(lan_host)
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
    app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="frontend")
    hosts = [lan_host] if lan_host == "0.0.0.0" else ["127.0.0.1", *([lan_host] if lan_host else [])]
    with ExitStack() as stack:
        listeners = []
        for host in hosts:
            listener = stack.enter_context(socket.socket(socket.AF_INET, socket.SOCK_STREAM))
            if os.name != "nt":
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                listener.bind((host, port))
            except OSError as error:
                raise SystemExit(f"无法监听 {host}:{port}（{error}）。请检查 IP 或更换端口。") from None
            listeners.append(listener)
        print(f"本机演示 http://127.0.0.1:{port}", flush=True)
        if lan_host:
            address = lan_host if lan_host != "0.0.0.0" else "<这台电脑的局域网 IP>"
            print(f"局域网演示 http://{address}:{port}", flush=True)
        server = uvicorn.Server(uvicorn.Config(app, workers=1, proxy_headers=False, access_log=False))
        try:
            server.run(sockets=listeners)
        except KeyboardInterrupt:
            return
        if not server.started:
            raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description="Trading Lab 本机与局域网演示")
    parser.add_argument("--lan", nargs="?", const="0.0.0.0", metavar="IPv4",
                        help="允许局域网访问，可指定本机的局域网 IPv4 地址")
    parser.add_argument("--port", type=int, default=8765, help="网页端口，默认 8765")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port 必须介于 1 和 65535。")
    if args.lan and args.lan != "0.0.0.0":
        try:
            address = IPv4Address(args.lan)
        except ValueError:
            parser.error("--lan 需要有效的 IPv4 地址。")
        if not any(address in network for network in PRIVATE_NETWORKS):
            parser.error("--lan 需要一个局域网 IPv4 地址。")
    if sys.version_info < (3, 11):
        raise SystemExit("请使用 Python 3.11 或更新版本启动。")
    if not REQUIREMENTS.is_file():
        raise SystemExit("请从完整解压的 Trading Lab 运行包启动。")
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    run_in_environment()
    configure_workspace(args.lan)
    serve(args.lan, args.port)


if __name__ == "__main__":
    main()
