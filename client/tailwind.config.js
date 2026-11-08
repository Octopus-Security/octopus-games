/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // The arcade games and admin panels are written against Tailwind's grays.
      // Map them onto the octopus-kit dark surfaces (tokens/tokens.json, dark) so
      // they sit on the same colours as the new chrome. Hex, not var(), so the
      // /50 style opacity modifiers keep working.
      colors: {
        gray: {
          50: '#f5f5f0', 100: '#e8e8ea', 200: '#d4d7de', 300: '#b9bec9', 400: '#9aa1ad',
          500: '#6b7280', 600: '#4a5160', 700: '#2a2f3a', 800: '#1c212a', 900: '#161a21', 950: '#0f1115',
        },
      },
    },
  },
  plugins: [],
};
