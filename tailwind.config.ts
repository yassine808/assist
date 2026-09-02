import type { Config } from "tailwindcss";

export default {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          dark: "#0f0f12",
          card: "#1a1a20",
        },
        riot: {
          red: "#ff4655",
          redDark: "#d32f2f",
        },
        rank: {
          gold: "#c8aa6e",
          silver: "#8492a6",
          bronze: "#cd7f32",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
