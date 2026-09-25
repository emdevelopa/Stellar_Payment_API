# User Permissions Manager Bundle Optimization

## Summary

Issue #1174 reduces the client-side cost of the User Permissions Manager while keeping the same accessible controls and visual feedback.

## Changes

- Removed the direct `framer-motion` dependency from `UserPermissionsManager`.
- Replaced row, toggle, and category affordance animations with Tailwind/CSS transitions.
- Preserved `motion-reduce` behavior for users who prefer reduced motion.
- Lazy-loaded the permissions manager from the Settings permissions tab with `next/dynamic`.
- Added a tabpanel wrapper around the settings permissions view for consistent screen-reader navigation.

## Accessibility

- Permission switches remain native checkboxes with stable `aria-label` values.
- Category groups keep `aria-expanded`, `aria-controls`, and region labels.
- Pending permission writes continue to set `aria-busy` on the manager region.
- Read-only mode disables controls and keeps the read-only notice visible.

## Verification

Run:

```bash
npm run test:unit -- UserPermissionsManager.test.tsx
npx eslint src/components/UserPermissionsManager.tsx "src/app/(authenticated)/settings/page.tsx"
```

Full build verification may still be blocked by unrelated syntax errors in other frontend files and by `next/font` network access in restricted environments.
