import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          green: "#16a34a",
          greenHover: "#22c55e"
        }
      },
      boxShadow: {
        soft: "0 10px 30px rgba(0,0,0,0.15)"
      }
    }
  },
  plugins: []
};

export default config;
