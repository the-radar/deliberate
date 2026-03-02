import importlib.util
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "deliberate-commands.py"
spec = importlib.util.spec_from_file_location("deliberate_commands_hook", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class DeliberateCommandsHookTests(unittest.TestCase):
    def test_extract_candidate_names_from_npm_install(self):
        command = "npm install @anthropic-ai/sandbox-runtime@0.0.34 browser-use@1.2.3"
        names = module._extract_candidate_names(command)

        self.assertIn("@anthropic-ai/sandbox-runtime", names)
        self.assertIn("browser-use", names)

    def test_extract_candidate_names_from_python_pip_git_reference(self):
        command = (
            "python3 -m pip install "
            "git+https://github.com/example/browser-use.git#egg=browser-use"
        )
        names = module._extract_candidate_names(command)

        self.assertIn("browser-use", names)
        self.assertIn("example/browser-use", names)

    def test_extract_candidate_names_from_gitlab_reference(self):
        command = "uv tool install git+https://gitlab.com/group/subgroup/tooling.git"
        names = module._extract_candidate_names(command)

        self.assertIn("group/subgroup/tooling", names)
        self.assertIn("tooling", names)

    def test_auto_approve_match_uses_normalized_command(self):
        command = "sudo env FOO=bar browser-use open https://example.com"
        matched = module.auto_approve_match(command, ["browser-use"])

        self.assertEqual(matched, "browser-use")

    def test_record_only_enabled_from_boolean_toggle(self):
        original_loader = module._load_config
        try:
            module._load_config = lambda: {"deliberate": {"recordOnly": True}}
            self.assertTrue(module.deliberate_record_only_enabled())
        finally:
            module._load_config = original_loader

    def test_record_only_enabled_from_mode_string(self):
        original_loader = module._load_config
        try:
            module._load_config = lambda: {"deliberate": {"mode": "record-only"}}
            self.assertTrue(module.deliberate_record_only_enabled())
        finally:
            module._load_config = original_loader

    def test_explain_everything_enabled_from_boolean_toggle(self):
        original_loader = module._load_config
        try:
            module._load_config = lambda: {"deliberate": {"explainEverything": True}}
            self.assertTrue(module.deliberate_explain_everything_enabled())
        finally:
            module._load_config = original_loader

    def test_load_skip_commands_uses_defaults_when_explain_everything_off(self):
        original_loader = module._load_config
        try:
            module._load_config = lambda: {"deliberate": {"explainEverything": False}, "skipCommands": {}}
            skip = module.load_skip_commands()
            self.assertIn("ls", skip)
        finally:
            module._load_config = original_loader

    def test_load_skip_commands_disables_defaults_when_explain_everything_on(self):
        original_loader = module._load_config
        try:
            module._load_config = lambda: {"deliberate": {"explainEverything": True}, "skipCommands": {}}
            skip = module.load_skip_commands()
            self.assertNotIn("ls", skip)
        finally:
            module._load_config = original_loader


if __name__ == "__main__":
    unittest.main()
