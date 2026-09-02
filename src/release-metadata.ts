export const MANAGED_GAME_SLUGS = new Set([
  "astro-bro", "butts", "commanders", "tower-defense", "racing-maze",
  "blend-in", "web-dodge", "motion-tracker", "balloon", "labyrinth"
]);

// Older immutable manifests predate sourceCommittedAt. These exact commits were
// verified through GitHub's commit API on 2026-09-02; never infer from branch HEAD.
export const LEGACY_COMMIT_DATES: Readonly<Record<string, string>> = Object.freeze({
  "5bdd70657cba228b2f87700f7d6173d08a59eb14": "2026-04-30T03:57:30.000Z",
  "e05e32210d2023ac75605784a866c697a4970320": "2026-08-31T02:28:16.000Z",
  "6cda8a91644be4edf9e272e94009f094fad532f8": "2026-09-02T01:01:08.000Z",
  "5b072a83cee36d055a46715b96ea2a68073ca11b": "2026-08-26T23:32:28.000Z",
  "b686bcd3e9da1ea7d2a8f791f7b15fa599ef446a": "2026-05-11T01:25:55.000Z",
  "4fbe4f3a79575c0a95c17b457b8c631e688ca9b8": "2026-08-26T02:35:44.000Z",
  "56947de9ea16e9e4884295488101e9bb11f0e08e": "2026-08-26T04:21:47.000Z",
  "3fc0485b38d72ab0ccccc027570f4e2142b69d5c": "2026-08-26T15:09:34.000Z"
});
