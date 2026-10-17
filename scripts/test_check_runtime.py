#!/usr/bin/env python3
"""Behavioral tests driving the prerequisite checker as an external CLI."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CHECKER = Path(__file__).resolve().with_name("check_runtime.py")
VERSIONS = {
    "opencode": "2.0.32",
    "node": "v24.0.0",
    "git": "git version 2.47.0",
    "python3": "Python 3.12.0",
    "docker": "Docker version 27.3.1, build abc123",
}


class RuntimeCLITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=CHECKER.parent)
        self.addCleanup(self.temp.cleanup)
        self.bin_dir = Path(self.temp.name)
        self.env = dict(os.environ, PATH=str(self.bin_dir))
        for name, version in VERSIONS.items():
            self.program(name, "print({!r})\n".format(version))

    def program(self, name, body):
        path = self.bin_dir / name
        path.write_text(
            "#!" + sys.executable + "\n"
            "import sys\n"
            "if sys.argv[1:] != ['--version']:\n"
            "    sys.exit(99)\n" + body,
            encoding="utf-8",
        )
        path.chmod(0o755)

    def run_cli(self, json_output=True):
        return subprocess.run(
            [sys.executable, str(CHECKER)] + (["--json"] if json_output else []),
            env=self.env,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

    def report(self, expected_code):
        result = self.run_cli()
        self.assertEqual(result.returncode, expected_code, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(set(data), {"checks", "ok"})
        self.assertIs(data["ok"], expected_code == 0)
        self.assertEqual([item["name"] for item in data["checks"]], list(VERSIONS))
        for item in data["checks"]:
            self.assertEqual(set(item), {"name", "status", "detail"})
            self.assertIn(item["status"], {"ok", "missing", "unsupported", "error"})
            self.assertIsInstance(item["detail"], str)
            self.assertTrue(item["detail"])
        checks = {item["name"]: item for item in data["checks"]}
        self.assertIn("CLI only", checks["docker"]["detail"])
        self.assertIn("daemon/image not checked", checks["docker"]["detail"])
        return checks

    def assert_only_failure(self, name, status):
        checks = self.report(1)
        for executable, item in checks.items():
            self.assertEqual(item["status"], status if executable == name else "ok", item)
        return checks[name]

    def test_success(self):
        for item in self.report(0).values():
            self.assertEqual(item["status"], "ok")

    def test_newer_node_supported(self):
        self.program("node", "print('v26.1.0')\n")
        self.assertEqual(self.report(0)["node"]["status"], "ok")

    def test_missing_executables(self):
        for name, version in VERSIONS.items():
            with self.subTest(name=name):
                (self.bin_dir / name).unlink()
                self.assert_only_failure(name, "missing")
                self.program(name, "print({!r})\n".format(version))

    def test_unsupported_versions(self):
        for name, version in (("opencode", "2.0.31"), ("opencode", "2.0.33"),
                              ("opencode", "2.0.32-beta.1"), ("node", "v23.9.0")):
            with self.subTest(name=name, version=version):
                self.program(name, "print({!r})\n".format(version))
                item = self.assert_only_failure(name, "unsupported")
                self.assertIn(version.lstrip("v"), item["detail"])
                self.program(name, "print({!r})\n".format(VERSIONS[name]))

    def test_failing_executable(self):
        self.program("git", "print('controlled failure', file=sys.stderr)\nsys.exit(7)\n")
        item = self.assert_only_failure("git", "error")
        self.assertIn("7", item["detail"])
        self.assertIn("controlled failure", item["detail"])

    def test_unrecognized_version(self):
        self.program("opencode", "print('not a version')\n")
        self.assert_only_failure("opencode", "error")

    def test_empty_version(self):
        self.program("python3", "pass\n")
        self.assert_only_failure("python3", "error")

    def test_timeout(self):
        self.program("docker", "import time\ntime.sleep(30)\n")
        item = self.assert_only_failure("docker", "error")
        self.assertIn("timed out", item["detail"])
        self.assertIn("5 seconds", item["detail"])

    def test_human_output(self):
        result = self.run_cli(json_output=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in VERSIONS:
            self.assertIn(name + ": ok", result.stdout)
        self.assertIn("not a full runtime readiness check", result.stdout)
        self.assertIn("daemon/image not checked", result.stdout)
        (self.bin_dir / "opencode").unlink()
        result = self.run_cli(json_output=False)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("opencode: missing", result.stdout)
        self.assertIn("CLI prerequisites failed", result.stdout)


if __name__ == "__main__":
    unittest.main()
