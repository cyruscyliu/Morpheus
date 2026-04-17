import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.generate_snapshot import (
    GitHubClient,
    build_snapshot,
    derive_activity_status,
    derive_drift_status,
    load_repo_list,
    write_snapshot,
)


class StubClient(GitHubClient):
    def __init__(self):
        super().__init__(token=None, base_url="https://example.invalid")

    def get_repo(self, identifier):
        if identifier == "missing/repo":
            raise RuntimeError("404 missing")
        repos = {
            "alpha/project": {
                "name": "project",
                "owner": {"login": "alpha"},
                "full_name": "alpha/project",
                "html_url": "https://github.com/alpha/project",
                "description": "Primary project",
                "fork": False,
                "default_branch": "main",
                "stargazers_count": 3,
                "forks_count": 1,
                "open_issues_count": 0,
                "pushed_at": "2026-04-15T10:00:00Z",
                "updated_at": "2026-04-15T10:00:00Z",
                "private": False,
            },
            "beta/forked": {
                "name": "forked",
                "owner": {"login": "beta"},
                "full_name": "beta/forked",
                "html_url": "https://github.com/beta/forked",
                "description": "Forked project",
                "fork": True,
                "parent": {"full_name": "upstream/forked"},
                "default_branch": "main",
                "stargazers_count": 2,
                "forks_count": 1,
                "open_issues_count": 1,
                "pushed_at": "2025-12-01T10:00:00Z",
                "updated_at": "2025-12-01T10:00:00Z",
                "private": False,
            },
            "gamma/unavailable": {
                "name": "unavailable",
                "owner": {"login": "gamma"},
                "full_name": "gamma/unavailable",
                "html_url": "https://github.com/gamma/unavailable",
                "description": None,
                "fork": True,
                "parent": {"full_name": "upstream/unavailable"},
                "default_branch": "main",
                "stargazers_count": 0,
                "forks_count": 0,
                "open_issues_count": 0,
                "pushed_at": "2026-01-10T10:00:00Z",
                "updated_at": "2026-01-10T10:00:00Z",
                "private": False,
            },
        }
        return repos[identifier]

    def get_commits(self, identifier, branch, limit=5):
        if identifier == "gamma/unavailable":
            raise RuntimeError("commit endpoint unavailable")
        return [
            {
                "sha": "abcdef123456",
                "html_url": f"https://github.com/{identifier}/commit/abcdef123456",
                "commit": {
                    "message": "Initial sync\n\nDetails",
                    "author": {"name": "Ada", "date": "2026-04-15T09:00:00Z"},
                },
                "author": {"login": "ada"},
            }
        ][:limit]

    def compare(self, parent, branch, fork):
        if fork == "gamma/unavailable":
            raise RuntimeError("compare failed")
        return {"ahead_by": 1, "behind_by": 27}


class RepoListTests(unittest.TestCase):
    def test_load_repo_list_collects_invalid_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "repos.txt"
            path.write_text("# comment\nalpha/project\nbad input\nalpha/project\n", encoding="utf-8")
            loaded = load_repo_list(path)

        self.assertEqual(loaded.identifiers, ["alpha/project"])
        self.assertEqual(len(loaded.errors), 1)
        self.assertEqual(loaded.errors[0]["type"], "invalid_identifier")


class SnapshotTests(unittest.TestCase):
    def test_status_helpers(self):
        now = datetime(2026, 4, 16, tzinfo=timezone.utc)
        self.assertEqual(derive_activity_status("2026-04-15T10:00:00Z", now), "active")
        self.assertEqual(derive_activity_status("2026-02-01T10:00:00Z", now), "quiet")
        self.assertEqual(derive_activity_status("2025-12-01T10:00:00Z", now), "stale")
        self.assertEqual(derive_drift_status(True, {"available": True, "behindBy": 27, "aheadBy": 1}), "drifting")
        self.assertEqual(derive_drift_status(True, {"available": False}), "unavailable")

    def test_build_snapshot_includes_errors_and_fork_fallback(self):
        now = datetime(2026, 4, 16, tzinfo=timezone.utc)
        snapshot = build_snapshot(
            ["alpha/project", "beta/forked", "gamma/unavailable", "missing/repo"],
            StubClient(),
            now=now,
        )

        self.assertEqual(snapshot["overview"]["tracked"], 3)
        self.assertEqual(snapshot["overview"]["forks"], 2)
        self.assertEqual(snapshot["overview"]["drifting"], 1)
        self.assertEqual(len(snapshot["errors"]), 2)

        unavailable = next(repo for repo in snapshot["repos"] if repo["id"] == "gamma/unavailable")
        self.assertFalse(unavailable["drift"]["available"])
        self.assertEqual(unavailable["driftStatus"], "unavailable")

    def test_write_snapshot_persists_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "repos.txt"
            output_path = Path(tmp) / "snapshot.json"
            input_path.write_text("alpha/project\n", encoding="utf-8")

            original_build_snapshot = __import__("scripts.generate_snapshot", fromlist=["build_snapshot"]).build_snapshot

            def fake_build_snapshot(repo_identifiers, client, now=None):
                return {
                    "generatedAt": "2026-04-16T10:00:00Z",
                    "thresholds": {},
                    "overview": {"tracked": 1, "forks": 0, "active": 1, "stale": 0, "drifting": 0},
                    "repos": [{"id": "alpha/project"}],
                    "errors": [],
                }

            module = __import__("scripts.generate_snapshot", fromlist=["build_snapshot"])
            module.build_snapshot = fake_build_snapshot
            try:
                snapshot = write_snapshot(input_path, output_path, token=None)
            finally:
                module.build_snapshot = original_build_snapshot

            self.assertEqual(snapshot["overview"]["tracked"], 1)
            written = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(written["repos"][0]["id"], "alpha/project")


if __name__ == "__main__":
    unittest.main()

