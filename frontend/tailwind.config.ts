import type { Config } from 'tailwindcss';

// Palette driven by CSS variables so the WHOLE UI flips light/dark from one place
// (globals.css). The `neutral` scale inverts between themes; accent text shades
// (300/400) darken in light mode for contrast. Only these shades are overridden —
// all other Tailwind colors keep their defaults (deep-merged via `extend`).
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        neutral: {
          50: v('--n-50'),
          100: v('--n-100'),
          200: v('--n-200'),
          300: v('--n-300'),
          400: v('--n-400'),
          500: v('--n-500'),
          600: v('--n-600'),
          700: v('--n-700'),
          800: v('--n-800'),
          900: v('--n-900'),
          950: v('--n-950'),
        },
        amber: { 300: v('--amber-300'), 400: v('--amber-400') },
        green: { 300: v('--green-300'), 400: v('--green-400') },
        red: { 300: v('--red-300'), 400: v('--red-400') },
        emerald: { 300: v('--emerald-300'), 400: v('--emerald-400') },
        purple: { 300: v('--purple-300'), 400: v('--purple-400') },
        blue: { 400: v('--blue-400') },
      },
    },
  },
  plugins: [],
};

export default config;
