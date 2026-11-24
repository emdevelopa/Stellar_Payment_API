# Real-time payment confirmation modal

`frontend/src/components/TransactionResultModal.tsx` confirms a submitted payment. It shows the amount, the recipient, a truncated transaction hash, and a Stellar Expert link to that transaction.

## Responsive drawer

| Viewport | Presentation |
| --- | --- |
| Below `sm` (640px) | Bottom drawer. Full width, rounded top corners, drag handle, safe-area padding. |
| `sm` and up | Centered dialog, max width `24rem`, rounded on all corners. The drag handle is hidden. |

Enter motion uses the shared `drawer-in` and `dialog-in` tokens. `prefers-reduced-motion: reduce` skips those animations and the drag snap transition.

## Touch gestures

A downward swipe dismisses the sheet. The sheet follows the finger. On release it closes when the drag is at least 100px or the flick is at least 0.5px/ms; otherwise it snaps back. The backdrop fades as the sheet moves.

Dragging inside the scrollable body only moves the sheet when that body is scrolled to the top. Horizontal movement does not dismiss it.

Gesture logic lives in `frontend/src/hooks/useSwipeToDismiss.ts`.

## Accessibility (WCAG 2.1 AA)

Swipe is an extra way to close, not the only one (2.5.1):

- Close button
- Done button
- Backdrop click
- Escape

The dialog uses `role="dialog"`, `aria-modal="true"`, and is named and described by its heading and summary. Focus moves into the dialog on open, Tab stays inside it, and focus returns to the trigger on close (2.4.3, 2.1.2). Page scroll is locked while it is open. Interactive targets are at least 44px and show a mint focus ring.

## Security

The explorer URL is always `https://stellar.expert`. `encodeURIComponent` keeps the hash in one path segment, so the value cannot change the origin or the scheme. The link opens with `rel="noopener noreferrer"`. The hash, amount, and recipient are rendered as text.

Copy is optimistic and rolls back if `navigator.clipboard.writeText` is missing or rejects. A failed attempt never leaves the "copied" state up, and an older failure cannot overwrite a newer success.

## Tests

```bash
cd frontend
npx vitest run src/components/TransactionResultModal.test.tsx
```

Covered: closed state, accessible name, hash truncation, explorer link encoding, close controls, focus trap, scroll lock, swipe dismiss, snap-back, scrolled-content guard, and clipboard success, failure, and rollback.
