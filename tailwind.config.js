/** @type {import('tailwindcss').Config} */
module.exports = {
  separator: "_",
  content: [
    "./src/views/*.{html,js,css,pug}",
    "./src/public/js/*.{html,js,css}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
