# Dragons VS. Vikings v1.0.0 — local proposal

Status: owner approved browser-only v1.0.0 on November 14, 2026; publication in progress.

- Creator: Jane Eland. Private source: `geland/dragons-and-vikings`.
- Original main: `4d2341ff67f064006c77fed5979c24e0db5553c3`.
- Release source: `b1b739df0b4a9e47a115faa1270f9687409526a6`, local
  branch `codex/browser-release` in `/Users/greg/Projects/dragons-and-vikings`.
- Proposed immutable version: `v1.0.0`, profile `web` only.
- Proposed public route: `/play/dragons-and-vikings`.
- This portal branch starts from protected-main
  `2db37f8623b636cb4b99baf9fc3e68319b4c213d`.

The game already uses Godot 4.6.2's Compatibility renderer. Its Web preset
disables threads/extensions, includes dynamically read JSON, and excludes
editor-only raw terrain data. Native downloads remain disabled. Browser
controls require a keyboard; saves remain in the browser/website profile.

Local evidence: all six game audits, 34 source release-tool checks, headed
Chromium title/tutorial/main-world/save-reload, clean Web export, portal tests,
release-tool suites, generated types and Worker builds pass. The portal's new
identity test refuses Mac and Web+Mac profiles and expects exactly one Web
candidate asset. Original test-only ObjectDB cleanup warnings remain in two
audits. Safari, physical Windows/mobile and production transfer performance
are unverified. See the source repository's browser candidate report for local
screenshots/logs. No private source is copied into this public repository.

The existing production read token must be verified for repository-only
Actions/Contents/metadata access to Jane's source. The updated access-check
workflow checks that repository without printing the credential. No production
credential belongs in the source repository.

After specific owner approval, follow the canonical private-game runbook.
Land this portal integration on protected main, push the approved source to its
main and wait for exact-source CI, create a new annotated tag, verify the single
private candidate asset and zero Actions artifacts, and dispatch the protected
publisher. Deploy the catalog card after the game is published so it has a
working destination. Prove stable/version identity, file hashes/MIME/cache and
the real public game with save/reload before reporting publication complete.

The owner approved the initial `57d080a` candidate. CI then required restoring
the unchanged shared Mac signing helper used by two tooling tests; commit
`b1b739d` adds that file only. Gameplay, Web exports and enabled targets are
unchanged. Source validation must succeed on this final SHA before tagging.
No version tag or public game deployment exists yet.
