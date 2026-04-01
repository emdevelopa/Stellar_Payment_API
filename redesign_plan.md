# Implementation Plan - Web3 UI Redesign

Redesign the landing page and global theme to match the "Unique Web3 Platform" style guide.

## Design System Updates

### 1. Color Palette
- **Primary (Background)**: `#0B0F1A` (Deep Navy/Black)
- **Secondary (Accents)**: `#6C5CE7` (Purple)
- **Accent (Highlights)**: `#00F5D4` (Neon Green/Cyan)
- **Gradient**: Purple (`#6C5CE7`) → Blue (`#3B82F6`) → Cyan (`#00F5D4`)

### 2. Typography
- **Headings**: `Space Grotesk` (already present) or `Sora`
- **Body**: `Inter` (need to add)

### 3. Aesthetics
- **Glassmorphism**: Semi-transparent backgrounds with blur.
- **Micro-animations**: Enhanced `framer-motion` interactions.
- **Grid Layout**: Clean grid with ample whitespace.

## Tasks

- [ ] **Task 1: Update Global Styles**
    - Modify `src/app/globals.css` to define new color variables and glassmorphism utilities.
    - Update `tailwind.config.js` to include the new colors and fonts.
- [ ] **Task 2: Update Layout**
    - Import `Inter` font in `src/app/layout.tsx`.
    - Apply `--font-heading` to headings and `--font-body` to body text.
- [ ] **Task 3: Redesign Landing Page (`src/app/(public)/page.tsx`)**
    - Implement the Hero Section with the new bold headline and animated background.
    - Update Features Section with glassmorphism cards and glowing icons.
    - Add "How It Works" and "Roadmap" sections as per the style guide.
    - Style the FAQ section with a collapsible accordion.
    - Update CTA buttons with hover glow effects.
- [ ] **Task 4: Polish & Verify**
    - Ensure responsive layouts for desktop, tablet, and mobile.
    - Verify smooth animations and transitions.
