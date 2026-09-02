const versionPattern = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric"
});

export function releasePresentation(value, slug) {
  if (!value || value.slug !== slug || typeof value.version !== "string"
    || !versionPattern.test(value.version) || typeof value.sourceCommit !== "string"
    || !/^[0-9a-f]{40}$/.test(value.sourceCommit)) return null;
  const timestamp = value.sourceCommittedAt;
  if (timestamp !== null && (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))
    || new Date(timestamp).toISOString() !== timestamp)) return null;
  if (timestamp === null) return { version: value.version, commit: value.sourceCommit, date: null };
  const date = new Date(timestamp);
  const parts = Object.fromEntries(dateFormat.formatToParts(date).map(({ type, value }) => [type, value]));
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", month: "2-digit"
  }).format(date);
  return {
    version: value.version, commit: value.sourceCommit,
    date: `${parts.year}-${month}-${parts.day.padStart(2, "0")}`,
    label: `Updated ${dateFormat.format(date)}`
  };
}

export async function refreshReleaseCard(card, fetchRelease = fetch) {
  const slug = card.dataset.releaseSlug;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? "")) return;
  const version = card.querySelector(".release-meta > span:first-child");
  const time = card.querySelector(".release-meta time");
  if (!version || !time) return;
  try {
    const response = await fetchRelease(`/api/releases/${slug}`, {
      cache: "no-store", signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return;
    const release = releasePresentation(await response.json(), slug);
    if (!release) return;
    version.textContent = release.version;
    version.title = `Published source commit ${release.commit}`;
    // Never pair a new version with an unrelated old date. Unknown legacy
    // commits show the version alone, rather than substituting publication time.
    time.parentElement.hidden = release.date === null;
    if (release.date !== null) {
      time.dateTime = release.date;
      time.textContent = release.label;
    }
  } catch {
    // Keep the readable static fallback on timeout, offline, or malformed data.
  }
}

export async function refreshReleaseCards(cards, fetchRelease = fetch) {
  await Promise.all([...cards].map((card) => refreshReleaseCard(card, fetchRelease)));
}
