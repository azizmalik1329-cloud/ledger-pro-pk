# Responsive navigation validation

- Desktop account dropdown exposes Business App, Super Admin (platform admins only), Settings & Users, and Logout.
- Desktop search remains visible in the main header.
- Mobile removes the legacy More/bottom navigation and exposes Dashboard, Khatay, Farokht, Khareedari, Stock, Cash, and Reports in the direct module rail.
- Mobile header replaces the legacy Logout button with Settings.
- Settings gains an account profile card with profile update and Logout; existing Team Management continues to manage owner/manager/staff access.
- Vercel preview build passes 6/6 accounting regression tests and Next.js/TypeScript compilation.
