// relay LP — minimal vanilla JS
// 1. Copy buttons for code blocks (with ✓ icon swap)
// 2. Subtle text-reveal on hero (CSS-driven, JS only as enhancement)
// No analytics, no tracking, no third-party.

(function () {
  "use strict";

  // ── Copy to clipboard ─────────────────────────────────────────
  const COPY_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M8 8h11v13H8z M5 5h11v3 M5 5v13h3"/></svg>`;
  const CHECK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 6L9 17l-5-5"/></svg>`;

  const copyButtons = document.querySelectorAll(".copy-btn[data-copy-target]");

  copyButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = btn.getAttribute("data-copy-target");
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (!target) return;

      const text = target.innerText;
      const label = btn.querySelector(".copy-label");
      const iconSlot = btn.querySelector("svg");
      const originalLabel = label ? label.textContent : "Copy";

      async function markCopied() {
        if (iconSlot) iconSlot.outerHTML = CHECK_SVG;
        if (label) label.textContent = "Copied";
        btn.classList.add("is-copied");

        setTimeout(() => {
          // Replace check icon back to copy icon
          const currentIcon = btn.querySelector("svg");
          if (currentIcon) currentIcon.outerHTML = COPY_SVG;
          if (label) label.textContent = originalLabel || "Copy";
          btn.classList.remove("is-copied");
        }, 1800);
      }

      try {
        await navigator.clipboard.writeText(text);
        await markCopied();
      } catch (_err) {
        // Fallback: select range (older browsers / non-secure contexts)
        const range = document.createRange();
        range.selectNodeContents(target);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
          try {
            document.execCommand("copy");
            await markCopied();
          } catch (_e) {
            if (label) label.textContent = "Failed";
          }
          sel.removeAllRanges();
        }
      }
    });
  });

  // ── Theme swatch tooltip (title attribute fallback is sufficient) ─
  // No additional JS needed; browsers show title as tooltip natively.

})();
