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
  const pageUrl = `https://${hostname}/?deploy=${cacheBust}`;
  const brandUrl = `https://${hostname}/brand-mark.svg?deploy=${cacheBust}`;
  const requestHeaders = {
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const [pageResponse, brandResponse] = await Promise.all([
    fetch(pageUrl, { headers: requestHeaders }),
    fetch(brandUrl, { headers: requestHeaders }),
  ]);
  const [pageHtml, brandSvg] = await Promise.all([pageResponse.text(), brandResponse.text()]);

  const pageIsCurrent = pageResponse.ok && pageHtml.includes("<title>Geland Games</title>");
  const brandIsCurrent = brandResponse.ok && brandSvg.includes("<svg");

  if (pageIsCurrent && brandIsCurrent) {
    console.log(`Verified Geland Games is live at https://${hostname}/.`);
    process.exit(0);
  }

  console.log(
    `Production verification ${attempt}/${attempts} is not current yet ` +
      `(page ${pageResponse.status}, brand ${brandResponse.status}).`,
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
