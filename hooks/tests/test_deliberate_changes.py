import importlib.util
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "deliberate-changes.py"
spec = importlib.util.spec_from_file_location("deliberate_changes_hook", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class DeliberateChangesHookTests(unittest.TestCase):
    def test_sensitive_path_is_dangerous(self):
        result = module.assess_change_risk_by_rules(
            operation="write",
            file_path="/Users/test/.ssh/authorized_keys",
            content="ssh-rsa AAAAB3Nza..."
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["risk"], "DANGEROUS")

    def test_sensitive_content_is_moderate(self):
        result = module.assess_change_risk_by_rules(
            operation="write",
            file_path="/tmp/config.txt",
            content="api_key=secret-value"
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["risk"], "MODERATE")

    def test_markdown_is_safe(self):
        result = module.assess_change_risk_by_rules(
            operation="write",
            file_path="/tmp/README.md",
            content="# docs"
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["risk"], "SAFE")


if __name__ == "__main__":
    unittest.main()
