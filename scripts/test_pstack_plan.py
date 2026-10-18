"""Check the shipped plan template against its real CLI validator."""
import pathlib
import re
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODE = ROOT / "skills/pstack-poteto-mode"


class PlanTemplateContract(unittest.TestCase):
    def test_shipped_plan_template_passes_the_validator(self):
        template = (MODE / "playbooks/multi-phase-plan.md").read_text()
        plan = template.split("````markdown\n", 1)[1].split("\n````", 1)[0]
        plan = re.sub(r"<[^>]+>", "local-proof", plan)
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "plan.md"
            path.write_text(plan)
            result = subprocess.run(
                ["node", str(MODE / "scripts/check-plan.mjs"), str(path)],
                text=True, capture_output=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
