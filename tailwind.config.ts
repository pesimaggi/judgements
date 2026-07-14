import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16233B",        // deep legal navy — headings, primary actions
        inkSoft: "#3D4E6C",
        paper: "#F7F8FA",      // cool paper background
        line: "#D8DDE6",
        accent: "#8C1D2F",     // deep Icelandic red — used sparingly (marks, active states)
        accentSoft: "#F6E8EA",
        euBlue: "#24418E"      // CJEU section identity
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
export default config;
