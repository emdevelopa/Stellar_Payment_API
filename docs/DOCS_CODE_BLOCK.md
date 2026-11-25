# Interactive API Code Block & Syntax Highlighter

`frontend/src/components/DocsCodeBlock.tsx` is the interactive code block and syntax highlighter component used throughout the documentation and developer guides. It renders multi-language code snippets, one-click copy affordances, responsive mobile drawer views, and code syntax highlighting.

## Responsive Drawer View (#1810)

| Viewport | Presentation |
| --- | --- |
| Standard (Desktop / Inline) | Inline code block within documentation body, rounded corners, dark Pluto background (`#0A0A0A`), terminal header bar. |
| Drawer View (Mobile / Expanded) | Bottom sheet drawer portaled to `document.body`. Full width, rounded top corners (`rounded-t-3xl`), drag handle affordance, safe-area padding, dimmed backdrop. |

Users on touch devices or smaller viewports (as well as desktop users inspecting large snippets) can open the drawer via the "Drawer" expand button in the header bar.

Motion uses the Tailwind `animate-drawer-in` token (`cubic-bezier(0.16,1,0.3,1)`). Reduced motion preferences (`prefers-reduced-motion: reduce`) skip enter animations.

## Touch Gestures (#1810)

The bottom drawer supports natural touch gestures:
- Downward drag follows the finger in real time (`translate3d(0, ${offset}px, 0)`).
- The backdrop opacity fades proportionally as the sheet is pulled down.
- On release, the drawer dismisses if the downward drag exceeds 100px or if a quick flick occurs (downward velocity >= 0.5px/ms); otherwise it snaps back smoothly.
- Scrollable code regions inside the drawer use a scroll guard (`scrollRef`): downward touch drags only move the drawer when the content is at the top (`scrollTop <= 0`), preventing conflicts with normal code scrolling.
- Gesture tracking is powered by `frontend/src/hooks/useSwipeToDismiss.ts`.

## Bundle Footprint Optimization & Dynamic Imports (#1812)

Syntax highlighting is powered by `frontend/src/lib/dynamic-syntax-highlighter.ts`:
- **Code splitting**: Neither `prismjs` nor heavy language grammar definition files are bundled into the critical initial client bundle.
- **On-demand imports**: When a code block mounts or when the user switches to a language tab (e.g. bash, javascript, typescript, python, json, rust, go, yaml, sql), the specific language grammar is loaded dynamically via `import(...)`.
- **Grammar caching**: Successfully imported grammars are cached in memory to eliminate redundant network fetches.
- **Immediate paint & SSR safety**: Raw code with safe HTML escaping renders immediately without layout shift or blocking paint while the syntax grammar resolves.

## WCAG 2.1 AA Keyboard Focus Management & Screen Reader Labels (#1809)

Accessibility conforms to WCAG 2.1 AA guidelines:
1. **Multi-language Tab Switcher**:
   - Tab list container uses `role="tablist"` with `aria-label="Code snippet languages"`.
   - Each tab button has `role="tab"`, `aria-selected`, `aria-controls`, and roving `tabIndex` (`0` for active tab, `-1` for inactive).
   - Arrow keys (`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`) navigate and focus tabs with wrapping. `Home` and `End` jump to the first and last tabs.
   - Code panel container uses `role="tabpanel"` and `aria-labelledby`.
2. **One-Click Copy Button**:
   - Explicit accessible name (`aria-label="Copy code snippet"` / `aria-label="Code copied to clipboard"`).
   - Live region (`role="status"`, `aria-live="polite"`) announces "Code snippet copied to clipboard" to assistive technologies.
3. **Scrollable Code Region**:
   - The code container has `role="region"` and `tabIndex={0}`, allowing keyboard users to scroll horizontal and vertical overflow using Arrow keys without requiring mouse interaction (WCAG 2.1.1).
4. **Drawer Dialog Focus Management**:
   - Drawer container uses `role="dialog"`, `aria-modal="true"`, and `aria-label`.
   - On open, focus automatically moves to the first interactive element inside the drawer.
   - Tab navigation is trapped inside the drawer dialog (WCAG 2.1.2).
   - `Escape` key closes the drawer.
   - Backdrop click/tap closes the drawer.
   - On close, focus automatically restores to the trigger button that opened the drawer.
   - Page scroll is locked (`overflow: hidden` on `document.body`) while the drawer is active.
5. **Focus Indicators**:
   - All interactive controls have distinct focus visible rings (`focus-visible:ring-2 focus-visible:ring-[var(--pluto-400)] focus-visible:outline-none`).

## Tests

```bash
cd frontend
npx vitest run src/lib/dynamic-syntax-highlighter.test.ts src/components/DocsCodeBlock.test.tsx
```
