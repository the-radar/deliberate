# Installer symlink EEXIST fix WORKFILE

One-line summary: fix `deliberate install` failing on existing broken symlinks for Antigravity/Gemini hook files.

## Problem statement and requirements
During live install validation, `deliberate install` failed with:
`EEXIST: file already exists, symlink ...`

Root cause:
- installer used `fs.existsSync(destPath)` before unlinking
- broken symlinks return false for `existsSync`
- stale symlink remained, then `symlinkSync` failed

Required outcome:
- installer must always remove existing file/symlink entries reliably, including broken links.

## Detailed implementation plan (checklist)
- [x] Add reusable path cleanup helper using `fs.lstatSync`.
- [x] Apply helper in Antigravity hook install path.
- [x] Apply helper in Gemini hook install path.
- [x] Re-run install command and verify success.
- [x] Re-run local tests.

## System context (relevant files)
- `/Users/h4tch1ing/Documents/deliberate/src/install.js`

## Security considerations and potential vulnerabilities
- No security model changes.
- Fix improves reliability, avoids partial-install states that can weaken expected oversight.

## Testing strategy
- `node --check src/install.js`
- `npm test`
- `deliberate install` end-to-end run

## Progress tracking
- [x] Workfile created
- [x] Implementation complete
- [x] Tests complete
- [x] Commit complete

## Validation notes
- `deliberate install` now succeeds end-to-end.
- `npm test` remains green (`12/12`).
