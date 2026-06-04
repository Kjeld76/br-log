/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Akzentfarbe für vertrauliche Bereiche (BR-Geheimnis)
        confidential: {
          bg: "#fef2f2",
          border: "#fecaca",
          text: "#991b1b",
        },
      },
    },
  },
  plugins: [],
};
