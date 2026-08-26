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

A manually dispatched candidate is useful for validation but is deliberately
ineligible for publication. Publishable candidates must come from an exact
`vMAJOR.MINOR.PATCH` tag so GitHub independently records the source SHA used by
the run.

The `game-release-production` environment must remain main-only, require a
reviewer other than the dispatcher, prevent self-review, and disallow bypass
before any credential is stored. Its private-repository token needs only
Actions read, Contents read, and metadata read for the allowlisted repositories.
Contents read is limited to resolving the approved tag reference. R2 and Apple
credentials remain separate from all game source repositories.
