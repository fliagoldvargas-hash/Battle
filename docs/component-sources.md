# Component and motion sources

No external UI component library was copied into FLIPPEN. Existing React components were redesigned in place to preserve the product's functional contracts.

## GSAP

- Library: GSAP core and `@gsap/react`
- Official documentation: https://gsap.com/resources/React/
- Installation: `npm install gsap @gsap/react`
- Variant: React `useGSAP` with scoped refs and `gsap.matchMedia()`
- Date reviewed: 2026-08-14
- License consulted: GSAP package license and `@gsap/react` package license
- Local changes: limited to hero and battle-list entrance timelines; reduced-motion opt-out and automatic cleanup are enabled.

## UI primitives

- Origin: local project components
- Components: navigation, modal, notifications, battle cards, SVG icon set and crown mark
- Changes: restyled and accessibility behavior strengthened; no third-party component source copied.
