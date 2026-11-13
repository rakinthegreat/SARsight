/** @type {import('next').NextConfig} */
// NEXT_DIST lets verification builds use their own folder without disturbing a running `next dev`.
export default { reactStrictMode: true, distDir: process.env.NEXT_DIST || ".next" };
