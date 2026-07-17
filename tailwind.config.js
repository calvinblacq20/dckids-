/**
 * Storefront Tailwind build config. Replaces the runtime Play CDN with a
 * pre-purged stylesheet so cheap-Android / 3G visitors don't download a
 * ~300KB compiler on every visit. Mirrors the old inline `tailwind.config`
 * that was in index.html (brand colors + fonts, Preflight ON).
 *
 * Rebuild after adding NEW Tailwind classes:  npm run build:css  (from server/)
 */
const path = require('path');

module.exports = {
  // Absolute paths (relative to this config) so the build works no matter which
  // directory the CLI is invoked from.
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'track.html'),
    path.join(__dirname, 'app.js'),
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['Playfair Display', 'serif'],
      },
      colors: {
        brand: {
          green: '#5E9C7E',
          darkgreen: '#0F4C3A',
          bg: '#FAFAF8',
          pink: '#FCECEC',
        },
      },
    },
  },
  plugins: [],
};
