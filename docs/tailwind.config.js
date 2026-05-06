// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  corePlugins: {
    preflight: false, // disable Tailwind's reset
  },
  content: ['./src/**/*.{js,jsx,ts,tsx}', './{docs,blog}/**/*.{md,mdx}'], // my markdown stuff is in ../docs, not /src
  darkMode: ['class', '[data-theme="dark"]'], // hooks into docusaurus' dark mode settings
  theme: {
    extend: {
      colors: {
        // Light Theme
        'deep-primary': '#4250af',
        'deep-bg': '#f9f8fb',
        'deep-fg': 'black',
        'deep-gray': '#F6F6F4',

        // Dark Theme
        'deep-dark-primary': '#adcbfa',
        'deep-dark-bg': '#000000',
        'deep-dark-fg': '#e5e7eb',
        'deep-dark-gray': '#111111',
      },
    },
  },
  plugins: [],
};
