import json
import logging
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health, logs, relay, serial
from app.config import Settings, get_settings
from app.models.relay import ApiError
from app.services.audit_log_service import AuditLogService
from app.services.exceptions import ServiceError
from app.services.relay_service import RelayService
from app.services.serial_service import SerialService

logger = logging.getLogger(__name__)

BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8000
FRONTEND_HOST = "127.0.0.1"
FRONTEND_PORT = 5173
STARTUP_TIMEOUT_SECONDS = 30.0

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
BACKEND_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}"
FRONTEND_URL = f"http://localhost:{FRONTEND_PORT}"

_HTTP_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class StartupError(RuntimeError):
    """Raised when the development environment cannot be started safely."""


def create_app(
    settings: Settings | None = None,
    *,
    serial_service: SerialService | None = None,
    audit_log_service: AuditLogService | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    logging.basicConfig(
        level=logging.DEBUG if app_settings.debug else logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    serial_service = serial_service or SerialService(app_settings)
    audit_log_service = audit_log_service or AuditLogService()
    relay_service = RelayService(serial_service, audit_log_service)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "%s 后端启动，API 前缀: %s",
            app_settings.app_name,
            app_settings.api_prefix,
        )
        try:
            yield
        finally:
            serial_service.disconnect()
            logger.info("%s 后端已停止", app_settings.app_name)

    app = FastAPI(
        title=app_settings.app_name,
        description="Windows 本机 LCUS-1 USB 继电器控制 API",
        version="0.3.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.serial_service = serial_service
    app.state.relay_service = relay_service
    app.state.audit_log_service = audit_log_service

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    app.include_router(serial.router, prefix=app_settings.api_prefix)
    app.include_router(relay.router, prefix=app_settings.api_prefix)
    app.include_router(logs.router, prefix=app_settings.api_prefix)
    app.include_router(health.router, prefix=app_settings.api_prefix)

    @app.exception_handler(ServiceError)
    async def service_error_handler(
        _: Request,
        exc: ServiceError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=ApiError(detail=exc.message, code=exc.code).model_dump(),
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.exception(
            "未处理异常: %s %s",
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content=ApiError(
                detail="后端发生内部错误，请查看服务日志",
                code="INTERNAL_SERVER_ERROR",
            ).model_dump(),
        )

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {
            "name": app_settings.app_name,
            "docs": "/docs",
            "api": app_settings.api_prefix,
        }

    return app


app = create_app()


def _port_is_open(host: str, port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _http_text(url: str, timeout: float = 1.0) -> str | None:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json,text/html;q=0.9,*/*;q=0.8"},
    )
    try:
        with _HTTP_OPENER.open(request, timeout=timeout) as response:
            return response.read(64 * 1024).decode("utf-8", errors="replace")
    except (OSError, urllib.error.URLError, ValueError):
        return None


def _is_usb_relay_backend() -> bool:
    body = _http_text(f"{BACKEND_URL}/api/health")
    if body is None:
        return False

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return False
    return (
        payload.get("status") == "ok"
        and payload.get("service") == "USB Relay Web"
    )


def _is_vite_frontend() -> bool:
    body = _http_text(FRONTEND_URL)
    return body is not None and "/@vite/client" in body


def _backend_already_running() -> bool:
    """Return True when the current project's backend is already running."""
    if not _port_is_open(BACKEND_HOST, BACKEND_PORT):
        return False

    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        if _is_usb_relay_backend():
            return True
        if not _port_is_open(BACKEND_HOST, BACKEND_PORT):
            return False
        time.sleep(0.2)

    raise StartupError(
        f"端口 {BACKEND_PORT} 已被其他程序占用。\n"
        "请关闭占用该端口的程序后重试。"
    )


def _vite_already_running() -> bool:
    """Return True when Vite is already running on the configured port."""
    if not _port_is_open(FRONTEND_HOST, FRONTEND_PORT):
        return False
    if _is_vite_frontend():
        return True

    raise StartupError(
        f"端口 {FRONTEND_PORT} 已被其他程序占用，但未检测到 Vite。\n"
        "请关闭占用该端口的程序后重试。"
    )


def _find_npm() -> str:
    npm_command = shutil.which(
        "npm.cmd" if os.name == "nt" else "npm"
    )
    if npm_command is None:
        raise StartupError(
            "未找到 npm 命令，请确认已安装 Node.js 并加入 PATH。"
        )
    return npm_command


def _validate_frontend() -> None:
    package_path = FRONTEND_DIR / "package.json"
    node_modules = FRONTEND_DIR / "node_modules"

    if not package_path.is_file():
        raise StartupError(f"未找到前端配置文件：{package_path}")
    if not node_modules.is_dir():
        raise StartupError(
            "前端依赖未安装，请先执行 npm install。\n"
            f"目录：{FRONTEND_DIR}"
        )

    try:
        package_data = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StartupError(f"无法读取 frontend/package.json：{exc}") from exc

    scripts = package_data.get("scripts")
    if not isinstance(scripts, dict) or not scripts.get("dev"):
        raise StartupError(
            "frontend/package.json 中未找到 dev 脚本，"
            "无法执行 npm run dev。"
        )


def _start_frontend(npm_command: str) -> subprocess.Popen[Any]:
    command = [npm_command, "run", "dev"]
    if os.name == "nt":
        command = [
            os.environ.get("COMSPEC", "cmd.exe"),
            "/d",
            "/s",
            "/c",
            npm_command,
            "run",
            "dev",
        ]

    popen_options: dict[str, Any] = {
        "cwd": str(FRONTEND_DIR),
        "stdin": subprocess.DEVNULL,
        "env": os.environ.copy(),
    }
    if os.name == "nt":
        popen_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_options["start_new_session"] = True

    try:
        return subprocess.Popen(
            command,
            **popen_options,
        )
    except OSError as exc:
        raise StartupError(f"无法启动前端开发服务器：{exc}") from exc


def _wait_for_frontend(process: subprocess.Popen[Any]) -> None:
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if _is_vite_frontend():
            return

        return_code = process.poll()
        if return_code is not None:
            raise StartupError(
                f"Vite 进程已退出，退出码：{return_code}。\n"
                "请检查上方 npm 输出。"
            )
        time.sleep(0.2)

    raise StartupError(
        f"等待 Vite 在 {STARTUP_TIMEOUT_SECONDS:.0f} 秒内启动超时。\n"
        f"请检查端口 {FRONTEND_PORT} 和上方 npm 输出。"
    )


def _stop_frontend(process: subprocess.Popen[Any] | None) -> None:
    if process is None or process.poll() is not None:
        return

    print("\n[System] 正在停止 Vite...", flush=True)
    if os.name == "nt":
        # npm.cmd is a batch wrapper; Ctrl+Break can leave an interactive
        # "Terminate batch job?" prompt. Kill the whole tree instead.
        try:
            killer = subprocess.Popen(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            killer.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)
            return
        except (OSError, subprocess.TimeoutExpired):
            pass

        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            pass

    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass


def _open_browser_when_ready() -> None:
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if _is_usb_relay_backend() and _is_vite_frontend():
            print("\n[System] USB Relay Web 启动完成", flush=True)
            print("[System] 浏览器正在打开...", flush=True)
            webbrowser.open(FRONTEND_URL)
            return
        time.sleep(0.2)

    print("\n[System] 等待服务就绪超时，浏览器未自动打开。", flush=True)


def _run_project() -> int:
    frontend_process: subprocess.Popen[Any] | None = None
    stop_event = threading.Event()
    server_holder: list[Any] = []
    previous_handlers: dict[int, Any] = {}

    def handle_stop(_signum: int, _frame: Any) -> None:
        stop_event.set()
        if server_holder:
            server_holder[0].should_exit = True

    print("USB Relay Web 正在启动...\n", flush=True)
    try:
        if threading.current_thread() is threading.main_thread():
            handled_signals = [signal.SIGINT, signal.SIGTERM]
            if hasattr(signal, "SIGBREAK"):
                handled_signals.append(signal.SIGBREAK)
            for handled_signal in handled_signals:
                try:
                    previous_handlers[handled_signal] = signal.signal(
                        handled_signal,
                        handle_stop,
                    )
                except (OSError, ValueError):
                    pass

        backend_running = _backend_already_running()
        if backend_running:
            print(
                f"[Backend] FastAPI: {BACKEND_URL} "
                "(已检测到当前项目后端，复用现有进程)",
                flush=True,
            )
        else:
            print(f"[Backend] FastAPI: {BACKEND_URL}", flush=True)
        print(f"[Backend] API:     {BACKEND_URL}/api", flush=True)
        print(f"[Backend] Docs:    {BACKEND_URL}/docs", flush=True)

        frontend_running = _vite_already_running()
        if frontend_running:
            print(
                f"[Frontend] Vite:   {FRONTEND_URL} "
                "(已检测到 Vite，复用现有进程)",
                flush=True,
            )
        else:
            _validate_frontend()
            npm_command = _find_npm()
            print("\n[Frontend] 正在启动 Vite...", flush=True)
            frontend_process = _start_frontend(npm_command)
            _wait_for_frontend(frontend_process)
            print(f"[Frontend] Vite:   {FRONTEND_URL}", flush=True)

        if backend_running:
            print("\n[System] USB Relay Web 启动完成", flush=True)
            print("[System] 浏览器正在打开...", flush=True)
            webbrowser.open(FRONTEND_URL)

            if frontend_process is not None:
                print(
                    "\n[System] FastAPI 使用现有进程，"
                    "按 Ctrl+C 停止本次启动的 Vite。",
                    flush=True,
                )
                while frontend_process.poll() is None:
                    if stop_event.wait(0.2):
                        break
                if stop_event.is_set():
                    print(
                        "\n[System] 收到 Ctrl+C，正在关闭...",
                        flush=True,
                    )
            return 0

        import uvicorn

        class ControlledServer(uvicorn.Server):
            @contextmanager
            def capture_signals(self) -> Iterator[None]:
                # The launcher owns signal handling so cleanup always runs.
                yield

        threading.Thread(
            target=_open_browser_when_ready,
            daemon=True,
            name="browser-opener",
        ).start()
        server = ControlledServer(
            uvicorn.Config(
                app,
                host=BACKEND_HOST,
                port=BACKEND_PORT,
                reload=False,
                log_level="debug" if get_settings().debug else "info",
            )
        )
        server_holder.append(server)
        server.run()
        return 0
    except KeyboardInterrupt:
        print("\n[System] 收到 Ctrl+C，正在关闭...", flush=True)
        return 0
    except StartupError as exc:
        print(f"\n[System] 启动失败\n原因：{exc}", flush=True)
        return 1
    except Exception as exc:
        print(f"\n[System] 启动失败\n原因：{exc}", flush=True)
        return 1
    finally:
        _stop_frontend(frontend_process)
        for handled_signal, previous_handler in previous_handlers.items():
            try:
                signal.signal(handled_signal, previous_handler)
            except (OSError, ValueError):
                pass


if __name__ == "__main__":
    raise SystemExit(_run_project())
