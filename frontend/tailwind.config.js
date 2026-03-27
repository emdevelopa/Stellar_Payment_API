/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        night: "#0b0c10",
        tide: "#0f1a2b",
        mint: "#5ef2c0",
        glow: "#b8ffe2"
      },
      fontFamily: {
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
    }
  },
  plugins: []
};
