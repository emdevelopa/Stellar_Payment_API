# Developer Documentation Sidebar Navigation

`frontend/src/components/DocsSidebar.tsx` is the primary sidebar navigation component for the developer documentation and guides. It provides collapsible hierarchy navigation, live search anchor filtering, active section scroll spying, and keyboard focus management.

## Collapsible Documentation Hierarchy (#1814)

Documentation entries define structured sections and anchor headings:
- **Collapsible sub-sections**: Each documentation guide can contain subsections (such as Integration Architecture, Backend Configuration, Step-by-Step Implementation, HMAC Verification, etc.).
- **Automatic expansion**: The guide matching the current route (`pathname === /docs/${slug}`) automatically expands on page load and route changes.
- **Toggle controls**: Collapsible guides feature an expand/collapse toggle button equipped with:
  - `aria-expanded="true|false"`
  - `aria-controls="sections-${slug}"`
  - Accessible name (`aria-label="Toggle ${title} subsections"`)
  - Animated chevron indicator that rotates 90 degrees when open (respecting `motion-reduce:transition-none`).
- **Keyboard shortcuts**: When a guide row is focused, pressing `ArrowRight` expands the subsections, and pressing `ArrowLeft` collapses them.

## Search Anchor Navigation (#1814)

A dedicated search filter bar sits at the top of the sidebar:
- **Real-time filtering**: Filters guides and subsections by title, description, or section name.
- **Automatic expansion**: During an active search, all guides containing matching subsections automatically expand so matching anchors are immediately visible.
- **Screen reader announcements**: An `aria-live="polite"` live region (`role="status"`) announces the number of matching guides found (e.g., "3 documentation guides found matching 'webhook'").
- **Keyboard jump**: Pressing `ArrowDown` inside the search input directly moves keyboard focus to the first search result in the navigation list.
- **Quick clear**: A clear button and the `Escape` key reset the search query and restore the full navigation hierarchy.

## Active Section Spy (#1814)

The sidebar implements client-side scroll spying using `IntersectionObserver`:
- Watches heading anchors (`h2[id]`, `h3[id]`) within the documentation article.
- Identifies the heading currently in the active reading viewport.
- Marks the corresponding sidebar section anchor with `aria-current="location"` and distinct visual feedback (accent dot, primary Pluto color, and semibold font weight).

## WCAG 2.1 AA Accessibility & Keyboard Focus Management (#1814)

Accessibility adheres to WCAG 2.1 AA requirements:
- **Landmark semantics**: The component is wrapped in `<nav aria-label="Documentation navigation">`.
- **Page & Location State**: Active guide links receive `aria-current="page"`, and active heading anchors receive `aria-current="location"`.
- **Screen Reader Badges**: The "New" badge includes hidden screen reader context (`<span className="sr-only">New article: </span>New`).
- **List & Role Semantics**: All links maintain valid `role="link"` semantics inside structured `role="list"` and `role="listitem"` containers.
- **Keyboard List Navigation**:
  - `ArrowDown` / `ArrowUp`: Navigates between focusable links and buttons.
  - `ArrowRight`: Expands collapsed subsections.
  - `ArrowLeft`: Collapses expanded subsections.
  - `Home`: Moves focus to the first navigation item (Overview).
  - `End`: Moves focus to the last visible item.
- **Visible Focus Rings**: All interactive links, buttons, and search inputs have prominent visible focus rings (`focus-visible:ring-2 focus-visible:ring-[var(--pluto-500)] focus-visible:ring-offset-2 focus-visible:outline-none`).
- **Contrast**: Text and accent tokens strictly satisfy WCAG 2.1 AA contrast requirements (>= 4.5:1 for standard text).

## Tests

```bash
cd frontend
npx vitest run src/components/DocsSidebar.test.tsx
```
