# Account profile and session navigation

`frontend/src/components/UserNav.tsx` is the signed-in merchant menu in the dashboard header. It shows the organization (business name and email), links to Dashboard, Account Settings, and Support, and signs the session out.

## Responsive drawer

| Viewport | Presentation |
| --- | --- |
| Below `md` (768px) | Bottom drawer, portaled to `document.body`. Full width, rounded top, drag handle, safe-area padding, dimmed backdrop. |
| `md` and up | Anchored dropdown beside the avatar. No drag handle. |

Phones in landscape stay on the drawer. The dropdown starts at tablet width, where the header has room for an anchored menu.

Enter motion uses the shared `drawer-in` and `dialog-in` tokens. `prefers-reduced-motion: reduce` skips those animations and the drag snap transition.

## Touch gestures

A downward swipe dismisses the drawer. The sheet follows the finger and the backdrop fades with it. On release it closes when the drag is at least 100px or the flick is at least 0.5px/ms; otherwise it snaps back.

Dragging inside the scrollable menu only moves the sheet when that region is scrolled to the top. Horizontal movement does not dismiss it. The dropdown does not listen for swipes.

Gesture logic lives in `frontend/src/hooks/useSwipeToDismiss.ts`.

## Accessibility (WCAG 2.1 AA)

Swipe is an extra way to close the drawer, not the only one (2.5.1):

- Close button
- Backdrop click or tap
- Escape

The panel uses `role="dialog"` and is named and described by its heading and summary. The drawer sets `aria-modal="true"`. Focus moves into the dialog on open, Tab stays inside it, and focus returns to the avatar button on close (2.4.3, 2.1.2). Page scroll is locked while the drawer is open. Menu targets are at least 44px and show a visible focus ring. The current destination uses `aria-current="page"`.

## Security

Sign-out calls the merchant store, which removes the session token, API key, and merchant record, then navigates to the fixed `/login` path. The menu does not accept a return URL. Business name and email are rendered as text. API keys and webhook secrets are not read or shown.

## Tests

```bash
cd frontend
npx vitest run src/components/UserNav.test.tsx src/i18n/messages.test.ts
```

Covered: empty session, initials, secret redaction, current link, close and focus return, Escape, focus wrap, outside press, sign-out order, dropdown versus drawer, scroll lock, swipe dismiss, flick dismiss, snap-back, scrolled-content guard, and catalogue keys for en, es, fr, and pt.
