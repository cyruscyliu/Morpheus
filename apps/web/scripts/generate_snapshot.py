#!/usr/bin/env python3
"""Generate a static snapshot for the ossr dashboard."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib import error, parse, request

ACTIVE_DAYS = 7
RECENT_DAYS = 30
STALE_DAYS = 90
DRIFT_THRESHOLD = 10
RECENT_COMMITS_LIMIT = 5
REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


@dataclass
class RepoLoadResult:
    identifiers: list[str]
    errors: list[dict[str, str]]


class GitHubClient:
    """Small GitHub REST client for public data."""

    def __init__(self, token: str | None = None, base_url: str = "https://api.github.com"):
        self.token = token
        self.base_url = base_url.rstrip("/")

    def get_repo(self, identifier: str) -> dict[str, Any]:
        return self._get_json(f"/repos/{identifier}")

    def get_commits(self, identifier: str, branch: str, limit: int = RECENT_COMMITS_LIMIT) -> list[dict[str, Any]]:
        params = parse.urlencode({"sha": branch, "per_page": str(limit)})
        return self._get_json(f"/repos/{identifier}/commits?{params}")

    def compare(self, parent: str, branch: str, fork: str) -> dict[str, Any]:
        basehead = parse.quote(f"{parent}:{branch}...{fork}:{branch}", safe=":.")
        return self._get_json(f"/repos/{parent}/compare/{basehead}")

    def _get_json(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "ossr-snapshot-generator",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        req = request.Request(url, headers=headers)
        try:
            with request.urlopen(req) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"GitHub API error {exc.code} for {url}: {body}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"GitHub API request failed for {url}: {exc.reason}") from exc


def load_repo_list(path: Path) -> RepoLoadResult:
    identifiers: list[str] = []
    errors: list[dict[str, str]] = []
    seen: set[str] = set()

    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        candidate = raw.strip()
        if not candidate or candidate.startswith("#"):
            continue
        if not REPO_PATTERN.match(candidate):
            errors.append(
                {
                    "repo": candidate,
                    "type": "invalid_identifier",
                    "message": f"Line {line_number} is not a valid owner/repo identifier.",
                }
            )
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        identifiers.append(candidate)

    return RepoLoadResult(identifiers=identifiers, errors=errors)


def parse_iso8601(timestamp: str | None) -> datetime | None:
    if not timestamp:
        return None
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


def days_since(timestamp: str | None, now: datetime) -> int | None:
    parsed = parse_iso8601(timestamp)
    if parsed is None:
        return None
    delta = now - parsed.astimezone(timezone.utc)
    return max(delta.days, 0)


def derive_activity_status(pushed_at: str | None, now: datetime) -> str:
    age_days = days_since(pushed_at, now)
    if age_days is None:
        return "unknown"
    if age_days <= ACTIVE_DAYS:
        return "active"
    if age_days <= RECENT_DAYS:
        return "recent"
    if age_days >= STALE_DAYS:
        return "stale"
    return "quiet"


def derive_drift_status(is_fork: bool, drift: dict[str, Any] | None) -> str:
    if not is_fork:
        return "n/a"
    if not drift or not drift.get("available"):
        return "unavailable"
    behind = drift.get("behindBy", 0)
    ahead = drift.get("aheadBy", 0)
    if behind > DRIFT_THRESHOLD:
        return "drifting"
    if behind > 0:
        return "behind"
    if ahead > 0:
        return "ahead-only"
    return "aligned"


def summarize_repo_status(activity_status: str, drift_status: str) -> str:
    if drift_status == "drifting":
        return "drifting"
    if activity_status == "stale":
        return "stale"
    if activity_status == "active":
        return "active"
    if activity_status == "recent":
        return "recent"
    return activity_status


def normalize_commit(item: dict[str, Any]) -> dict[str, Any]:
    commit = item.get("commit", {})
    author = commit.get("author", {}) or {}
    return {
        "sha": item.get("sha"),
        "shortSha": (item.get("sha") or "")[:7],
        "message": (commit.get("message") or "").splitlines()[0],
        "date": author.get("date"),
        "author": author.get("name") or (item.get("author") or {}).get("login") or "unknown",
        "url": item.get("html_url"),
    }


def build_repo_entry(identifier: str, client: GitHubClient, now: datetime) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    errors: list[dict[str, str]] = []
    try:
        repo = client.get_repo(identifier)
    except RuntimeError as exc:
        errors.append({"repo": identifier, "type": "repo_fetch_failed", "message": str(exc)})
        return None, errors

    if repo.get("private"):
        errors.append({"repo": identifier, "type": "not_public", "message": "Repository is not public."})
        return None, errors

    branch = repo.get("default_branch") or "main"
    commits: list[dict[str, Any]] = []
    try:
        commits = [normalize_commit(item) for item in client.get_commits(identifier, branch)]
    except RuntimeError as exc:
        errors.append({"repo": identifier, "type": "commit_fetch_failed", "message": str(exc)})

    drift: dict[str, Any] | None = None
    if repo.get("fork"):
        parent = repo.get("parent") or {}
        parent_full_name = parent.get("full_name")
        if parent_full_name:
            try:
                comparison = client.compare(parent_full_name, branch, identifier)
                drift = {
                    "available": True,
                    "parent": parent_full_name,
                    "aheadBy": comparison.get("ahead_by", 0),
                    "behindBy": comparison.get("behind_by", 0),
                }
            except RuntimeError as exc:
                drift = {
                    "available": False,
                    "parent": parent_full_name,
                    "aheadBy": None,
                    "behindBy": None,
                    "message": str(exc),
                }
        else:
            drift = {
                "available": False,
                "parent": None,
                "aheadBy": None,
                "behindBy": None,
                "message": "Fork parent information was not available.",
            }

    activity_status = derive_activity_status(repo.get("pushed_at"), now)
    drift_status = derive_drift_status(bool(repo.get("fork")), drift)
    status = summarize_repo_status(activity_status, drift_status)
    last_commit = commits[0] if commits else None

    entry = {
        "id": identifier,
        "name": repo.get("name"),
        "owner": (repo.get("owner") or {}).get("login"),
        "fullName": repo.get("full_name"),
        "url": repo.get("html_url"),
        "description": repo.get("description"),
        "isFork": bool(repo.get("fork")),
        "parent": (repo.get("parent") or {}).get("full_name"),
        "defaultBranch": branch,
        "stars": repo.get("stargazers_count", 0),
        "forks": repo.get("forks_count", 0),
        "openIssues": repo.get("open_issues_count", 0),
        "pushedAt": repo.get("pushed_at"),
        "updatedAt": repo.get("updated_at"),
        "activityDays": days_since(repo.get("pushed_at"), now),
        "activityStatus": activity_status,
        "driftStatus": drift_status,
        "status": status,
        "drift": drift,
        "recentCommits": commits,
        "latestCommit": last_commit,
    }
    return entry, errors


def build_snapshot(repo_identifiers: Iterable[str], client: GitHubClient, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    repos: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for identifier in repo_identifiers:
        entry, repo_errors = build_repo_entry(identifier, client, now)
        errors.extend(repo_errors)
        if entry:
            repos.append(entry)

    repos.sort(key=lambda item: (item["activityDays"] is None, item["activityDays"] or 10**9, item["fullName"]))
    overview = {
        "tracked": len(repos),
        "forks": sum(1 for repo in repos if repo["isFork"]),
        "active": sum(1 for repo in repos if repo["activityStatus"] == "active"),
        "stale": sum(1 for repo in repos if repo["activityStatus"] == "stale"),
        "drifting": sum(1 for repo in repos if repo["driftStatus"] == "drifting"),
    }
    return {
        "generatedAt": now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "thresholds": {
            "activeDays": ACTIVE_DAYS,
            "recentDays": RECENT_DAYS,
            "staleDays": STALE_DAYS,
            "driftBehindCommits": DRIFT_THRESHOLD,
            "recentCommitsLimit": RECENT_COMMITS_LIMIT,
        },
        "overview": overview,
        "repos": repos,
        "errors": errors,
    }


def write_snapshot(input_path: Path, output_path: Path, token: str | None = None) -> dict[str, Any]:
    loaded = load_repo_list(input_path)
    snapshot = build_snapshot(loaded.identifiers, GitHubClient(token=token))
    snapshot["errors"] = loaded.errors + snapshot["errors"]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    return snapshot


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="config/repos.txt", help="Path to tracked repositories file.")
    parser.add_argument("--output", default="generated/snapshot.json", help="Path to output snapshot JSON.")
    parser.add_argument("--token-env", default="GITHUB_TOKEN", help="Environment variable holding a GitHub token.")
    parser.add_argument(
        "--fail-on-empty",
        action="store_true",
        help="Exit non-zero if the input contains repos but none could be fetched successfully.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    token = os.environ.get(args.token_env)
    input_path = Path(args.input)
    output_path = Path(args.output)
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    loaded = load_repo_list(input_path)
    snapshot = build_snapshot(loaded.identifiers, GitHubClient(token=token))
    snapshot["errors"] = loaded.errors + snapshot["errors"]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")

    if args.fail_on_empty and loaded.identifiers and snapshot["overview"]["tracked"] == 0:
        print(
            f"Snapshot generation failed: 0/{len(loaded.identifiers)} repositories were fetched successfully.",
            file=sys.stderr,
        )
        return 2

    print(
        f"Generated snapshot for {snapshot['overview']['tracked']} repositories with "
        f"{len(snapshot['errors'])} reported issues at {output_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
