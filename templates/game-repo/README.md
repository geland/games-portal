# Gregeland Godot game repository template

This directory is copied into a private game repository. It validates a Godot
4.6.2 project on ordinary pushes and builds short-lived unsigned Web and/or
universal macOS candidates only from an exact semantic version tag or an
explicitly dispatched commit. It does not publish.

The template is Gregeland-specific, but it receives no Apple, Cloudflare, or R2
credential. Protected signing and publication run separately from the public
`geland/games-portal` release authority after an artifact handoff is explicitly
approved. This template does not deploy the portal, edit DNS, create
repositories, or create tokens.

## Install it in a game repository

1. Copy the contents of this directory, including `.github` and the two
   `.gregeland-release*` files, into the game repository. Do not replace the
   game's existing `.gitignore`; merge any needed generated-output rules.
2. Edit `.gregeland-release.json`:
   - use the slug from the portal release contract;
   - set `projectPath` relative to the repository root;
   - enable only approved targets;
   - match the existing export preset names and Mac bundle name;
   - point `mac.entitlements` at a tracked plist only when the app actually
     needs hardened-runtime exceptions.
3. Ensure `export_presets.cfg` is tracked. A Web preset must be single-threaded,
   use the Compatibility renderer, and not enable extensions or PWA mode. A Mac
   preset needs a unique bundle identifier. The release verifies that the
   exported executable contains both `arm64` and `x86_64` slices.
4. If the project has automated tests, copy `scripts/ci-test.sh.example` to
   `scripts/ci-test.sh` and replace the example command. The workflow supplies
   `GODOT_BIN`.
5. If other development-only content must be removed, copy
   `scripts/ci-sanitize-stage.sh.example` to `scripts/ci-sanitize-stage.sh`.
   Its arguments are a disposable copy under `RUNNER_TEMP` and the target name
   (`web` or `mac`). The built-in
   sanitizer already excludes `addons/godot_ai` and removes its editor plugin
   and `_mcp_game_helper` autoload from the staged `project.godot`; the source
   checkout is never modified. Web and Mac always receive separate fresh
   stages, so a Web-only Compatibility override cannot downgrade the Mac build.

Run the release-tool tests locally with Node 24:

```sh
npm ci --prefix .github/release-tools --ignore-scripts --no-audit
npm test --prefix .github/release-tools
```

## GitHub configuration

No repository variable or secret is required. Leave Actions' default workflow
token read-only. An exact tag or `workflow_dispatch` is a deliberate build
gate, but the resulting one-day artifact is unsigned and unpublished.

## Candidate build

For the normal path, tag the exact reviewed commit:

```sh
git tag v1.0.0 <full-commit-sha>
git push origin v1.0.0
```

The tag glob is deliberately broad because GitHub workflow globs are not
regular expressions; the authorization job rejects anything that is not
exactly `vMAJOR.MINOR.PATCH` (with no leading zeroes or suffix). A manual run
requires both that exact version and the full 40-character commit SHA.

The workflow uploads unsigned candidates with one-day retention. These files
are build evidence, not a public release. Never present an unsigned Mac
candidate as a downloadable game. The protected portal workflow must validate
the exact source/run/artifact identity, repackage it into the constrained
Gregeland container, and perform signing/publication on a fresh runner before a
stable manifest can exist.

## What the workflow verifies

- Official Godot 4.6.2 editor and templates are downloaded from
  `godotengine/godot-builds` and checked against pinned SHA-256 digests.
- Release configuration, renderer, presets, and dev-secret hygiene are checked.
- Import and project-specific headless tests run against a sanitized stage.
- Web output must include non-empty HTML, JavaScript, PCK, and valid WebAssembly.
- Mac output remains unsigned. Signing, notarization, stapling, verification,
  and release-manifest publication belong only to the protected portal job.

The automated checks do not replace real Safari/iPhone/iPad, controller, audio,
camera, LAN, or fresh-Mac launch acceptance tests. Native iOS/TestFlight/App
Store distribution is outside this template.
