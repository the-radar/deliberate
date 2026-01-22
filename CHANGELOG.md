# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] - 2026-01-21

### Added
- **Antigravity Support:** Added `PreToolUse` and `PostToolUse` hooks via shell scripts in `~/.antigravity/hooks/`.
- **Gemini CLI Support:** Added `pre-command` and `post-file-change` hooks via shell scripts in `~/.gemini/hooks/`.
- **Robust Model Installation:** Added a Python-based fallback for downloading ML models if the direct GitHub release download fails (fixes 404 errors).

### Changed
- **Unified Architecture:** All platforms (Claude Code, OpenCode, Antigravity, Gemini) now use the exact same Python analysis engine (`deliberate-commands.py`).
- **Installer:** Updated `src/install.js` to automatically detect and configure Antigravity and Gemini environments.

### Fixed
- Fixed duplicate step numbering in the installer output.
- Fixed model download failure by adding a fallback mechanism.

## [1.0.4] - 2026-01-21

### Added
- **OpenCode Support:** Added `deliberate-plugin.js` and `deliberate-changes-plugin.js` for OpenCode integration.
- **Plugin Architecture:** Created a bridge to allow OpenCode plugins to utilize the core Python analysis engine.

### Changed
- **README:** Updated documentation to include OpenCode installation and usage instructions.

## [1.0.3] - 2026-01-17

### Fixed
- Fixed a bug where `None` explanation was returned when the LLM used tools internally.
- Simplified hook code by extracting helpers to reduce duplication.

## [1.0.2] - 2026-01-14

### Added
- **Workflow Detection:** Added detection for dangerous patterns like `REPO_WIPE`, `MASS_DELETE`, `HISTORY_REWRITE`, and `TEMP_SWAP`.
- **Automatic Backups:** Implemented pre-destruction backups that run *before* user confirmation.
- **Consequence Visualization:** Added detailed previews of what files/lines will be deleted or modified by destructive commands.
- **Layer 4 Safety:** Added a "Catch-All" backup layer for any destructive command.

### Changed
- **License:** Switched to source-available (UNLICENSED) from MIT.

## [1.0.1] - 2026-01-11

### Fixed
- Fixed security workflow paths after project restructure.
- Added missing `express` dependency to `package.json`.

## [1.0.0] - 2026-01-11

### Initial Release
- **Core Safety Layer:** Pattern matching, ML classification (CmdCaliper), and LLM explanations.
- **Claude Code Support:** Initial hooks for `PreToolUse` and `PostToolUse`.
- **CLI:** Basic `deliberate` CLI for status and manual classification.
