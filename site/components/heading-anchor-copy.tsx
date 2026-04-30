"use client";

import { useEffect } from "react";

/**
 * Click-to-copy heading anchors.
 *
 * Replaces the default Nextra anchor link behaviour (which adds the hash to
 * the URL but doesn't do anything visible because you're already on the page)
 * with: copy the full canonical URL to clipboard and show a brief toast.
 *
 * Renders nothing visible; lives in the layout so every doc page gets it.
 */
export function HeadingAnchorCopy() {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a.subheading-anchor") as HTMLAnchorElement | null;
      if (!anchor) return;

      event.preventDefault();
      const href = anchor.getAttribute("href") || "";
      const url = href.startsWith("#")
        ? `${window.location.origin}${window.location.pathname}${href}`
        : new URL(href, window.location.href).toString();

      navigator.clipboard
        .writeText(url)
        .then(() => showToast("Link copied"))
        .catch(() => showToast("Press ⌘C to copy"));

      // Also push the hash into the URL bar so the browser back-button works.
      try {
        history.replaceState(null, "", href);
      } catch {
        /* noop */
      }
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}

let activeToast: HTMLDivElement | null = null;
let activeToastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string) {
  if (activeToast) {
    activeToast.remove();
    activeToast = null;
  }
  if (activeToastTimer) {
    clearTimeout(activeToastTimer);
    activeToastTimer = null;
  }

  const toast = document.createElement("div");
  toast.textContent = message;
  toast.setAttribute("role", "status");
  toast.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:2rem",
    "transform:translateX(-50%) translateY(0.5rem)",
    "padding:0.55rem 0.95rem",
    "border-radius:999px",
    "background:#101113",
    "color:#fafaf7",
    "font:500 0.85rem/1 var(--font-geist-sans, system-ui, sans-serif)",
    "letter-spacing:0.01em",
    "box-shadow:0 12px 30px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.12)",
    "opacity:0",
    "transition:opacity 140ms ease, transform 140ms ease",
    "pointer-events:none",
    "z-index:9999",
  ].join(";");
  document.body.appendChild(toast);
  activeToast = toast;

  // Trigger fade-in on next frame
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });

  activeToastTimer = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(0.5rem)";
    setTimeout(() => {
      toast.remove();
      if (activeToast === toast) activeToast = null;
    }, 200);
  }, 1600);
}
