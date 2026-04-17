#!/usr/bin/env python3
"""Serve ossr locally with rebuilds and browser auto-reload."""

from __future__ import annotations

import argparse
import os
import queue
import subprocess
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn


IGNORE_DIRS = {"dist", "generated", "__pycache__", ".git", ".codex"}
WATCH_EXTENSIONS = {
    ".py",
    ".txt",
    ".html",
    ".css",
    ".mjs",
    ".md",
    ".json",
    ".yaml",
    ".yml",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--interval", type=float, default=1.0, help="Watch polling interval in seconds.")
    parser.add_argument(
        "--refresh-snapshot",
        action="store_true",
        help="Regenerate generated/snapshot.json before rebuilding the site.",
    )
    return parser.parse_args()


class ReloadBroker:
    def __init__(self) -> None:
        self._listeners: set[queue.Queue[str]] = set()
        self._lock = threading.Lock()

    def subscribe(self) -> queue.Queue[str]:
        listener: queue.Queue[str] = queue.Queue()
        with self._lock:
            self._listeners.add(listener)
        return listener

    def unsubscribe(self, listener: queue.Queue[str]) -> None:
        with self._lock:
            self._listeners.discard(listener)

    def broadcast(self, message: str = "reload") -> None:
        with self._lock:
            listeners = list(self._listeners)
        for listener in listeners:
            listener.put(message)


class DevHTTPRequestHandler(SimpleHTTPRequestHandler):
    broker: ReloadBroker

    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self) -> None:
        if self.path == "/__reload":
            self.handle_reload_stream()
            return
        super().do_GET()

    def handle_reload_stream(self) -> None:
        listener = self.broker.subscribe()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(b"retry: 1000\n\n")
            self.wfile.flush()
            while True:
                try:
                    message = listener.get(timeout=30)
                except queue.Empty:
                    message = "ping"
                self.wfile.write(f"data: {message}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            self.broker.unsubscribe(listener)


def should_watch(path: Path) -> bool:
    if any(part in IGNORE_DIRS for part in path.parts):
        return False
    return path.suffix in WATCH_EXTENSIONS


def snapshot_paths(root: Path) -> dict[Path, float]:
    mtimes: dict[Path, float] = {}
    for path in root.rglob("*"):
        if path.is_file() and should_watch(path.relative_to(root)):
            mtimes[path] = path.stat().st_mtime
    return mtimes


def run_command(root: Path, command: list[str]) -> bool:
    env = os.environ.copy()
    result = subprocess.run(command, cwd=root, env=env, check=False)
    return result.returncode == 0


def generate_snapshot(root: Path) -> bool:
    return run_command(
        root,
        [
            "python3",
            "scripts/generate_snapshot.py",
            "--input",
            "config/repos.txt",
            "--output",
            "generated/snapshot.json",
            "--fail-on-empty",
        ],
    )


def build_site(root: Path) -> bool:
    return run_command(root, ["python3", "scripts/build_site.py"])


def rebuild(root: Path, refresh_snapshot: bool = False) -> bool:
    if refresh_snapshot and not generate_snapshot(root):
        return False
    return build_site(root)


def watch_and_rebuild(root: Path, broker: ReloadBroker, interval: float, refresh_snapshot: bool) -> None:
    previous = snapshot_paths(root)
    while True:
        time.sleep(interval)
        current = snapshot_paths(root)
        if current == previous:
            continue
        previous = current
        print("Change detected, rebuilding...")
        if rebuild(root, refresh_snapshot=refresh_snapshot):
            print("Rebuild complete, notifying browser.")
            broker.broadcast("reload")
        else:
            print("Rebuild failed. Fix the error and save again.")


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parent.parent
    if not rebuild(root, refresh_snapshot=args.refresh_snapshot):
        return 1

    broker = ReloadBroker()
    handler = lambda *a, **kw: DevHTTPRequestHandler(*a, directory=str(root / "dist"), **kw)
    DevHTTPRequestHandler.broker = broker
    server = ThreadingHTTPServer((args.host, args.port), handler)

    watcher = threading.Thread(
        target=watch_and_rebuild,
        args=(root, broker, args.interval, args.refresh_snapshot),
        daemon=True,
    )
    watcher.start()

    print(f"Serving ossr at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
