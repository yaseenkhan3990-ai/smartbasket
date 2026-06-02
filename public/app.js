const loadingForm = document.querySelector("[data-loading-form]");
const loadingScreen = document.querySelector("[data-loading-screen]");
const loadingButton = document.querySelector("[data-loading-button]");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function runGsapAnimations() {
  if (!window.gsap || prefersReducedMotion) {
    return;
  }

  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;

  if (ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
  }

  gsap.defaults({
    duration: 0.7,
    ease: "power3.out"
  });

  const splitHeadingLines = gsap.utils.toArray("[data-split-heading] span");
  gsap.set([".nav",".hero-copy .eyebrow", ".hero-copy > p", ".search-panel", ".media-stage",  ".error-page"], {
    autoAlpha: 0,
    y: 24
  });
  gsap.set(splitHeadingLines, {
    autoAlpha: 0,
    y: (index) => (index % 2 === 0 ? 72 : -72),
    clipPath: "inset(0 0 100% 0)"
  });

  const heroTimeline = gsap.timeline();
  heroTimeline
    .to(".nav", { autoAlpha: 1, y: 0, duration: 0.55 })
    .to(".hero-copy .eyebrow", { autoAlpha: 1, y: 0 }, "-=0.15")
    .to(
      splitHeadingLines,
      {
        autoAlpha: 1,
        y: 0,
        clipPath: "inset(0 0 0% 0)",
        stagger: 0.16,
        duration: 0.8
      },
      "-=0.1"
    )
    .to(".hero-copy > p", { autoAlpha: 1, y: 0 }, "-=0.35")
    .to(".search-panel", { autoAlpha: 1, y: 0 }, "-=0.32")
    .to(".media-stage", { autoAlpha: 1, y: 0, duration: 0.8 }, "-=0.55")
    // .to(".result-hero > *", { autoAlpha: 1, y: 0, stagger: 0.12 }, "-=0.3")
    .to(".error-page", { autoAlpha: 1, y: 0 }, "-=0.45");

  const revealWithScroll = (targets, options = {}) => {
    const elements = gsap.utils.toArray(targets);
    if (!elements.length) return;

    if (!ScrollTrigger) {
      gsap.fromTo(elements, { autoAlpha: 0, y: 32 }, { autoAlpha: 1, y: 0, stagger: 0.08, ...options });
      return;
    }

    elements.forEach((element) => {
      const items = element.matches(".trust-row, .steps-grid, .demo-response, .insight-strip, .comparison-grid, .bar-list")
        ? Array.from(element.children)
        : [element];

      gsap.fromTo(
        items,
        { autoAlpha: 0, y: 42 },
        {
          autoAlpha: 1,
          y: 0,
          stagger: 0.09,
          ...options,
          scrollTrigger: {
            trigger: element,
            start: "top 82%",
            once: true
          }
        }
      );
    });
  };

  revealWithScroll(".trust-row, .landing-band, .steps-grid, .response-preview, .demo-response");
  revealWithScroll(".insight-strip, .product-strip, .ai-panel, .visual-compare, .bar-list, .comparison-grid");

  gsap.to(".analysis-svg", {
    y: -10,
    rotation: -1.2,
    duration: 2.8,
    ease: "sine.inOut",
    repeat: -1,
    yoyo: true
  });

  gsap.to(".floating-report", {
    y: 8,
    duration: 2.4,
    ease: "sine.inOut",
    repeat: -1,
    yoyo: true
  });

  gsap.utils.toArray(".offer-card, .bar-row, .steps-grid article, .demo-response div").forEach((card) => {
    card.addEventListener("mouseenter", () => {
      gsap.to(card, { y: -4, scale: 1.01, duration: 0.22, ease: "power2.out" });
    });

    card.addEventListener("mouseleave", () => {
      gsap.to(card, { y: 0, scale: 1, duration: 0.22, ease: "power2.out" });
    });
  });
}

if (loadingForm && loadingScreen) {
  loadingForm.addEventListener("submit", (event) => {
    if (!loadingForm.checkValidity()) {
      return;
    }

    loadingScreen.classList.add("is-visible");
    loadingScreen.setAttribute("aria-hidden", "false");

    if (window.gsap && !prefersReducedMotion) {
      window.gsap.fromTo(
        ".loading-card",
        { autoAlpha: 0, y: 20, scale: 0.96 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.35, ease: "power2.out" }
      );
      window.gsap.fromTo(
        ".loading-steps span",
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, stagger: 0.08, delay: 0.12, duration: 0.3 }
      );
    }

    if (loadingButton) {
      loadingButton.disabled = true;
      loadingButton.textContent = "Analyzing...";
    }
  });
}

window.addEventListener("DOMContentLoaded", runGsapAnimations);
