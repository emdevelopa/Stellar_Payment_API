# Onboarding Flow Hover States

This document captures the hover-state refinements applied to the onboarding flow so the registration experience better matches the global Drips Wave theme.

## Updated surfaces

- Registration form inputs now lift slightly on hover, brighten to white, and use Pluto border and shadow accents.
- The primary onboarding CTA now uses Pluto theme hover, focus, and active feedback instead of a flat black-only treatment.
- Secondary onboarding links now transition to Pluto accent tones for a more consistent navigation affordance.
- The onboarding progress tracker now uses Pluto-tinted container, step, and badge hover states while preserving completion and error semantics.

## Theme alignment

- Reused the existing `pluto` Tailwind color scale already defined in [frontend/tailwind.config.js](/Users/marvellous/Desktop/Stellar_Payment_API/frontend/tailwind.config.js).
- Kept the existing monochrome foundation, then layered Pluto hover accents so the change feels consistent with the current Drips Wave visual language.
- Preserved keyboard focus visibility and active-state feedback for accessible non-mouse interaction.

## Verification

- Added Playwright coverage in [frontend/tests/e2e/onboarding-hover.spec.ts](/Users/marvellous/Desktop/Stellar_Payment_API/frontend/tests/e2e/onboarding-hover.spec.ts).
- Verified the new hover behavior against the register onboarding flow on both desktop and mobile Playwright projects.
