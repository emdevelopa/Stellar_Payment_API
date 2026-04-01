/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        night: "var(--color-night)",
        tide: "var(--color-tide)",
        mint: "var(--color-mint)",
        glow: "var(--color-glow)",
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
        accent: "var(--color-accent)",
        gray: {
          950: "#000000",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)", "system-ui", "sans-serif"],
        body: ["var(--font-sans)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"]
      },
      keyframes: {
        "payment-confirmed": {
          "0%":   { backgroundColor: "rgba(34, 197, 94, 0.3)" },
          "50%":  { backgroundColor: "rgba(34, 197, 94, 0.15)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "payment-confirmed": "payment-confirmed 1.2s ease-out forwards",
      },
      backgroundColor: {
        dark: "#000000",
      },
    }
  },
  plugins: []
};
