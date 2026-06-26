/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface scale — deep slate, layered for depth
        base: '#0a0b10',
        surface: {
          DEFAULT: '#101218',
          raised: '#161922',
          overlay: '#1c2030',
          hover: '#222639'
        },
        line: {
          DEFAULT: '#262a3a',
          strong: '#343a52'
        },
        ink: {
          DEFAULT: '#e7e9f3',
          soft: '#a9adc4',
          faint: '#6b7090',
          ghost: '#474b64'
        },
        // Brand: kennel uses an electric iris/violet with warm amber accents
        iris: {
          DEFAULT: '#7c6cff',
          soft: '#9a8dff',
          deep: '#5b4ddb',
          glow: 'rgba(124, 108, 255, 0.35)'
        },
        amber: { DEFAULT: '#ffb454', soft: '#ffc97a' },
        mint: { DEFAULT: '#4fd6a8', soft: '#7fe6c4' },
        rose: { DEFAULT: '#ff6b8b', soft: '#ff97ad' }
      },
      fontFamily: {
        sans: [
          'Inter var',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif'
        ],
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'Menlo', 'monospace']
      },
      borderRadius: {
        xl: '14px',
        '2xl': '18px'
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124,108,255,0.4), 0 8px 30px -8px rgba(124,108,255,0.45)',
        node: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -10px rgba(0,0,0,0.6)',
        panel: '0 24px 60px -20px rgba(0,0,0,0.75)'
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' }
        },
        pulseline: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' }
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        },
        // Frosted-stage motion language
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(18px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'float-in': {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        'chip-pop': {
          from: { opacity: '0', transform: 'translateY(6px) scale(0.9)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        'fly-down': {
          from: { opacity: '0', transform: 'translateY(-10px) scale(0.96)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        'dock-in': {
          from: { opacity: '0', transform: 'translateY(26px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out',
        'scale-in': 'scale-in 0.16s cubic-bezier(0.2, 0.9, 0.3, 1)',
        pulseline: 'pulseline 1.6s ease-in-out infinite',
        'rise-in': 'rise-in 0.42s cubic-bezier(0.2, 0.9, 0.3, 1)',
        'float-in': 'float-in 0.34s cubic-bezier(0.2, 0.9, 0.3, 1)',
        'chip-pop': 'chip-pop 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)',
        'fly-down': 'fly-down 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)',
        'dock-in': 'dock-in 0.4s cubic-bezier(0.2, 0.9, 0.3, 1)'
      }
    }
  },
  plugins: []
}
