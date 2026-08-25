const filters = [...document.querySelectorAll(".filter")];
const filterable = [...document.querySelectorAll("[data-platforms]")];

for (const button of filters) {
  button.addEventListener("click", () => {
    const selected = button.dataset.filter;
    for (const candidate of filters) {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    }
    for (const item of filterable) {
      const platforms = item.dataset.platforms?.split(" ") ?? [];
      item.hidden = selected !== "all" && !platforms.includes(selected);
    }
  });
}

document.querySelector("#year").textContent = String(new Date().getFullYear());
