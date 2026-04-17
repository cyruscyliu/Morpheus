import unittest
from pathlib import Path
from unittest import mock

from scripts import dev_server


class DevServerTests(unittest.TestCase):
    def test_rebuild_only_builds_site_by_default(self):
        root = Path("/tmp/ossr")

        with mock.patch("scripts.dev_server.run_command", return_value=True) as run_command:
            ok = dev_server.rebuild(root)

        self.assertTrue(ok)
        run_command.assert_called_once_with(root, ["python3", "scripts/build_site.py"])

    def test_rebuild_refreshes_snapshot_when_requested(self):
        root = Path("/tmp/ossr")

        with mock.patch("scripts.dev_server.run_command", return_value=True) as run_command:
            ok = dev_server.rebuild(root, refresh_snapshot=True)

        self.assertTrue(ok)
        self.assertEqual(
            run_command.call_args_list,
            [
                mock.call(
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
                ),
                mock.call(root, ["python3", "scripts/build_site.py"]),
            ],
        )

    def test_rebuild_stops_when_snapshot_refresh_fails(self):
        root = Path("/tmp/ossr")

        with mock.patch("scripts.dev_server.run_command", side_effect=[False]) as run_command:
            ok = dev_server.rebuild(root, refresh_snapshot=True)

        self.assertFalse(ok)
        self.assertEqual(len(run_command.call_args_list), 1)


if __name__ == "__main__":
    unittest.main()
