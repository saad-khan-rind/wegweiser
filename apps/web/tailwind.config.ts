import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        paper: "var(--paper)",
        signal: "var(--signal)",
        amber: "var(--amber)",
        teal: "var(--teal)",
        rose: "var(--rose)",
        muted: "var(--muted)",
        line: "var(--line)",
        card: "var(--card)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: { xl2: "1.25rem" },
      keyframes: {
        drawline: { from: { strokeDashoffset: "1" }, to: { strokeDashoffset: "0" } },
        pulsehere: { "0%,100%": { transform: "scale(1)", opacity: "1" }, "50%": { transform: "scale(1.18)", opacity: "0.85" } },
        rise: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        pulsehere: "pulsehere 2.4s ease-in-out infinite",
        rise: "rise .5s cubic-bezier(.2,.7,.2,1) both",
      },
    },
  },
  plugins: [],
};
export default config;
