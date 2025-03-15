/** @type {import('tailwindcss').Config} */
module.exports = {
  separator: "_",
  content: [
    "./src/views/*.{html,js,css,pug}",
    "./src/public/js/*.{html,js,css}",
  ],
  theme: {
    fontSize: {
      'xs': '0.75rem',
      'sm': '0.875rem',
      'base': '16px',
      'lg': '1.125rem',
      'xl': '1.25rem',
      '2xl': '1.5rem',
    },
    extend: {
      fontFamily: {
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
