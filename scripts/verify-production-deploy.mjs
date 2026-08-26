const accountId = requireEnvironment("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnvironment("CLOUDFLARE_API_TOKEN");
const deploymentId = requireEnvironment("GITHUB_SHA");

const hostname = "games.gregeland.com";
const service = "gregeland-games";
const apiBase = "https://api.cloudflare.com/client/v4";

const domainsUrl = new URL(`${apiBase}/accounts/${accountId}/workers/domains`);
domainsUrl.searchParams.set("hostname", hostname);

const domainsResponse = await fetch(domainsUrl, {
  headers: { Authorization: `Bearer ${apiToken}` },
});
const domainsPayload = await parseJson(domainsResponse, "Cloudflare custom domains");

if (!domainsResponse.ok || domainsPayload.success !== true) {
  throw new Error(formatApiError("Cloudflare custom domains", domainsResponse, domainsPayload));
}

const matchingDomain = domainsPayload.result?.find((domain) => domain.hostname === hostname);

if (!matchingDomain) {
  throw new Error(`Cloudflare has no Worker custom domain for ${hostname}.`);
}

console.log(
  `Verified ${hostname} is bound to ${matchingDomain.service ?? "<unknown>"}` +
    `${matchingDomain.environment ? ` (${matchingDomain.environment})` : ""}.`,
);

if (matchingDomain.service !== service) {
  throw new Error(
    `${hostname} is bound to ${matchingDomain.service ?? "<unknown>"}, not ${service}.`,
  );
}

const attempts = 12;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const cacheBust = `${deploymentId}-${attempt}`;
  const markerUrl = `https://${hostname}/deploy-id.txt?deploy=${cacheBust}`;
  const brandUrl = `https://${hostname}/brand-mark.svg?deploy=${cacheBust}`;
  const requestHeaders = {
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const [markerResponse, brandResponse] = await Promise.all([
    fetch(markerUrl, { headers: requestHeaders }),
    fetch(brandUrl, { headers: requestHeaders }),
  ]);
  const [markerText, brandSvg] = await Promise.all([
    markerResponse.text(),
    brandResponse.text(),
  ]);

  const deploymentIsCurrent = markerResponse.ok && markerText.trim() === deploymentId;
  const brandIsCurrent = brandResponse.ok && brandSvg.includes("<svg");

  if (deploymentIsCurrent && brandIsCurrent) {
    console.log(`Verified Geland Games is live at https://${hostname}/.`);
    process.exit(0);
  }

  console.log(
    `Production verification ${attempt}/${attempts} is not current yet ` +
      `(marker ${markerResponse.status}, brand ${brandResponse.status}).`,
  );

  if (attempt < attempts) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

throw new Error(
  `Cloudflare accepted deployment ${deploymentId}, but https://${hostname}/ is still serving an older release.`,
);

function requireEnvironment(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

async function parseJson(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned a non-JSON response with status ${response.status}.`);
  }
}

function formatApiError(label, response, payload) {
  const messages = payload.errors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join("; ");

  return `${label} request failed with status ${response.status}${messages ? `: ${messages}` : "."}`;
}
