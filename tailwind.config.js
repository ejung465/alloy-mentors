/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        deepBlue: '#05060D', // Alloy obsidian base
        base: '#05060D',
        baseElevated: '#0A0C16',
        glassWhite: 'rgba(255, 255, 255, 0.06)',
        glassBorder: 'rgba(255, 255, 255, 0.12)',
        // Alloy accent trio
        mint: '#34E0A1',
        sky: '#38BDF8',
        iris: '#7C7AFF',
        gold: '#F5C451',
        rose: '#FB7A98',
      },
      fontFamily: {
        display: ['Inter-Black'],
        body: ['Inter-Regular'],
      }
    },
  },
  plugins: [],
}
