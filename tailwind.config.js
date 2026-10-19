/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surface: 'var(--surface)', 'surface-2': 'var(--surface-2)',
        text: 'var(--text)', muted: 'var(--text-muted)', border: 'var(--border)',
        primary: 'var(--primary)', 'primary-hover': 'var(--primary-hover)',
        'on-primary': 'var(--on-primary)', 'primary-soft': 'var(--primary-soft)',
        success: 'var(--success)', 'success-soft': 'var(--success-soft)',
        caution: 'var(--caution)', 'caution-soft': 'var(--caution-soft)',
        danger: 'var(--danger)', 'danger-soft': 'var(--danger-soft)',
      },
      borderRadius: { card: 'var(--radius-card)', btn: 'var(--radius-btn)', chip: 'var(--radius-chip)' },
      boxShadow: { card: 'var(--shadow-card)' },
      fontFamily: { sans: ['"Inter Variable"', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
