import { refreshReleaseCards } from "/release-metadata.js?v=1";

const filters = [...document.querySelectorAll(".filter")];
const filterable = [...document.querySelectorAll("[data-platforms]")];
const gameCount = document.querySelector("#game-count");

const filterNames = {
  browser: "browser",
  mac: "Mac",
  motion: "motion",
};

function updateGameCount(selected) {
  if (!gameCount) return;

  const visible = filterable.filter((item) => !item.hidden);
  const toolCount = visible.filter((item) => item.dataset.kind === "tool").length;
  const gameTotal = visible.length - toolCount;
  const scope = selected === "all" ? "" : `${filterNames[selected] ?? selected} `;
  const gameLabel = gameTotal === 1 ? "game" : "games";
  const toolLabel = toolCount === 1 ? "tool" : "tools";
  const tools = toolCount > 0 ? ` + ${toolCount} ${toolLabel}` : "";
  const shelf = selected === "all" ? " on the shelf" : "";

  gameCount.textContent = `${gameTotal} ${scope}${gameLabel}${tools}${shelf}`;
}

function applyFilter(button) {
  const selected = button.dataset.filter ?? "all";

  for (const candidate of filters) {
    const active = candidate === button;
    candidate.classList.toggle("active", active);
    candidate.setAttribute("aria-pressed", String(active));
  }

  for (const item of filterable) {
    const platforms = item.dataset.platforms?.split(" ") ?? [];
    item.hidden = selected !== "all" && !platforms.includes(selected);
  }

  updateGameCount(selected);
}

for (const button of filters) {
  button.addEventListener("click", () => applyFilter(button));
}

if (gameCount) {
  gameCount.setAttribute("aria-live", "polite");
  gameCount.setAttribute("aria-atomic", "true");
}

const initialFilter = filters.find((button) => button.getAttribute("aria-pressed") === "true")
  ?? filters[0];

if (initialFilter) {
  applyFilter(initialFilter);
} else {
  updateGameCount("all");
}

const year = document.querySelector("#year");
if (year) {
  year.textContent = String(new Date().getFullYear());
}

void refreshReleaseCards(document.querySelectorAll("[data-release-slug]"));
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void refreshReleaseCards(document.querySelectorAll("[data-release-slug]"));
});
