/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Lexend', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
      },
      colors: {
        brand: {
          blue:        '#2d7fc2',
          'blue-dark': '#1a5ea0',
          'blue-mid':  '#4a9dd4',
          'blue-light':'#e6f2fa',
          orange:      '#f5a128',
        },
      },
    },
  },
  plugins: [],
}
