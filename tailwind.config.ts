import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // A Nordic legal palette. The red accent it replaces read as an alert
        // colour on a page where nothing is wrong; navy, stone and glacier are
        // the register the courts themselves publish in.
        ink: "#0F2A44",        // Icelandic Blue — primary actions, headings, active nav
        inkSoft: "#3B5B7A",    // Stone Blue — secondary controls, muted headings
        glacier: "#E1E8F0",    // selected filters, subtle panels, hover
        paper: "#F8FAFC",      // Arctic — page ground
        text: "#1F2937",       // Charcoal — body copy
        textMuted: "#5A6A7A",  // metadata, labels (4.5:1 on #fff and #F8FAFC)
        line: "#E1E8F0",       // hairlines
        lineSoft: "#EDF1F5",   // row dividers, lighter than `line`
        lineStrong: "#C3CEDA", // input borders — borders only, never text
        // Moss marks one family and one control: the administrative and
        // oversight sources, and the Útdráttur disclosure. Anywhere else it
        // would stop meaning anything.
        moss: "#5B7A5E",
        mossSoft: "#EDF2ED",
        mossText: "#3E5A41",
        // Gold is a stroke, never a fill: the nav underline, the kicker rule,
        // the focus ring. Filled, it turns a research tool into a law firm's
        // letterhead.
        gold: "#B08D57",
        // Kept so the screens that have not been redesigned yet — the act
        // catalogue, the well — stay on palette rather than holding the old
        // red on their own.
        accent: "#3B5B7A",
        accentSoft: "#E1E8F0",
        euBlue: "#24418E"
      },
      fontFamily: {
        heading: ["var(--font-heading)", "Georgia", "serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
export default config;
