# Rising to Ultima v1.0.0 release proposal

Status: prepared locally; publication has not been approved or dispatched.

- Public source: `judaheland-dev/Rising-to-Ultima`, remote `main`.
- Exact source: `7e8056ac722b7f1c8db5109c41584b718f64c9ab`.
- Source committer date: September 21, 2026 (America/Los_Angeles).
- Proposed first immutable version: `v1.0.0`.
- Target: signed/notarized universal macOS, bundle `com.gregeland.risingtoultima`.
- Proposed catalog route: `/download/rising-to-ultima/mac`.

## Portal changes

Add a fixed source registry entry, manual workflow choice, Mac-only release
configuration, managed metadata slug, and catalog card with Judah's committed
Ground screenshot. The exact public source stays on Judah's account.

The disposable Mac stage supplies a missing export preset, enables Apple
Silicon texture imports, and keeps the original bytes of audio loaded through
`AudioStreamMP3.load_from_file` / `AudioStreamWAV.load_from_file`. Opening and
chamber-rumble audio retain ordinary imported-resource loading. Gameplay
scripts remain unchanged. Source tests, build tools, review documents, preview
images, and the empty Landscape.next.scn are excluded from the shipped pack.

Credential-free validation checks title loading, saves, and menu navigation,
then smoke-tests the exported app before its constrained artifact handoff.
Signing and production publication remain in the separate protected job.

## Local evidence

- Godot 4.6.2 import and universal Mac export completed.
- Exported executable contains arm64 and x86_64 architectures.
- Packaged-app title startup completed without runtime errors after raw-audio
  staging was applied. This caught an export-only missing audio problem that
  source-only checks did not expose.
- Title/load, save-bank/round-trip, and menu navigation suites: 44 PASS checks,
  zero failures/errors; dedicated restart-autosave suite also passed.
- Portal: 27 Worker tests and seven metadata tests passed; TypeScript and both
  Wrangler deployment dry runs passed.
- Public release tools: 25 tests passed.

## Remaining acceptance and source test caveat

The committed `new_game_picker.gd` test disables save-system processing and
then repeatedly requests new games without processing the pending autosave or
clearing its real-time cooldown. It fails waiting for subsequent starts, even
with a 60 FPS cap. Its initial Normal/Dev starts pass. The dedicated
`restart_autosave.gd` explicitly handles cooldown processing and passes. No
source test or gameplay code was edited to hide these results. The stale test
needs maintenance in Judah's source repository.

Browser publication remains disabled: excavation uses `Thread.start()` while
the default hosted Web preset disables threads. Browser work needs a separate
compatibility decision and real gameplay acceptance.

Local startup/headless checks do not establish a full downloaded-Mac playthrough
or physical keyboard/mouse performance acceptance. The first release still
requires protected signing, notarization, immutable publication, catalog
deployment, and live source/version/download verification after approval.
