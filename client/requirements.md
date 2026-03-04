## Packages
framer-motion | For smooth page transitions, modal animations, and layout shifts
recharts | For building beautiful, interactive charts on the dashboard
date-fns | For formatting dates in the history table and tooltips
clsx | For constructing conditional class names cleanly
tailwind-merge | For merging tailwind classes without conflicts

## Notes
- Dark mode is enforced by default to fit the "Rocket Lander" space aesthetic.
- The game asset (`rocket-lander...jsx`) is expected to be mounted in `GameWrapper.tsx`. I have provided a beautiful container for it, along with a "Simulator" panel so you can test database writes immediately even if the game's internal `onGameOver` callback isn't fully wired yet.
- Tailwind config needs to be updated to support the custom fonts (Outfit, DM Sans) via CSS variables.
