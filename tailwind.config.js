/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        card: '0 14px 30px rgba(5, 5, 5, 0.08)',
      },
      colors: {
        brand: {
          olive: '#75845D',
          lime: '#83B900',
          black: '#050505',
          white: '#FFFFFF',
          grey: '#DCDCDC',
          offwhite: '#F7F7F7',
          pale: '#F1F6E6',
          nav: '#E5E9F0',
          muted: '#A0A0A0',
        },
      },
    },
  },
  plugins: [],
}
