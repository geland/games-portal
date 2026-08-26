# Private-source release handoff

Private game repositories build exact tagged commits without production
credentials. Their candidate workflow emits one-day Gregeland data packages;
it does not sign or publish anything.

The manual portal workflow accepts only the fixed repositories in
`registry.json`, a successful tag-triggered candidate run, its exact source
SHA, and an approved release profile. The production runner verifies the
repository, workflow path, run conclusion, source SHA, fully resolved version
tag, absence of an ambiguous same-named branch, complete
artifact set, artifact digests, and the identity and byte layout inside every
package before signing or publication. It never checks out or executes private
source.

`web-dodge` and `motion-tracker` share one `geland/motion-games` tag workflow
run. Each central release selects only its exact SHA-qualified package, while
the verifier requires both expected run artifacts to be present and rejects
any extra, missing, renamed, or expired artifact. `balloon` and `labyrinth`
use the same fail-closed pattern in a separate native candidate workflow: one
exact-tag run must contain both SHA-qualified Mac packages, while a central
release selects and signs only the requested app. The native contract was
integrated against `geland/motion-games` commit
`56947de9ea16e9e4884295488101e9bb11f0e08e` and requires these exact bundle
identities:

- `Motion Balloon.app` — `com.gregeland.motionballoon`
- `Motion Labyrinth.app` — `com.gregeland.motionlabyrinth`

Both are Mac-only releases; their shared hosted tracker remains the independent
`motion-tracker` Web release. Commanders is not on this allowlist.

A manually dispatched candidate is useful for validation but is deliberately
ineligible for publication. Publishable candidates must come from an exact
`vMAJOR.MINOR.PATCH` tag so GitHub independently records the source SHA used by
the run.

The `game-release-production` environment must remain restricted to `main`.
The owner explicitly approved single-operator releases without an independent
GitHub environment reviewer on 2026-08-25. That accepted risk does not relax
manual dispatch, exact-tag/SHA checks, fresh production runners, or credential
separation. Its private-repository token needs only Actions read, Contents
read, and metadata read for the allowlisted repositories. Contents read is
limited to resolving the approved tag reference. R2 and Apple credentials
remain separate from all game source repositories.
