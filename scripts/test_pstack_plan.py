"""Check the shipped plan template against its real CLI validator."""
import pathlib
import re
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODE = ROOT / "skills/pstack-poteto-mode"


class PlanTemplateContract(unittest.TestCase):
    def test_installed_skill_plan_and_missing_resource_step(self):
        template = (MODE / "playbooks/multi-phase-plan.md").read_text()
        plan = template.split("````markdown\n", 1)[1].split("\n````", 1)[0]
        plan = re.sub(r"<[^>]+>", "local-proof", plan)
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "plan.md"
            for label, content, expected in (
                ("installed resources", plan, 0),
                ("missing resource-reading step", "\n".join(
                    line for line in plan.splitlines()
                    if "Read the installed skills" not in line
                ), 1),
            ):
                with self.subTest(label):
                    path.write_text(content)
                    result = subprocess.run(
                        ["node", str(MODE / "scripts/check-plan.mjs"), str(path)],
                        text=True, capture_output=True, timeout=10,
                    )
                    self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                    if expected:
                        self.assertIn('lacks "Read the installed skills"', result.stderr)


if __name__ == "__main__":
    unittest.main()
