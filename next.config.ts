import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * This Mac's own addresses on the local network (e.g. 192.168.0.206), so a
 * phone on the same Wi-Fi can open the dev server. Without them Next.js
 * blocks the page's scripts for that origin: the page renders but never
 * starts, and the map sits on "Loading map..." forever.
 */
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a!.address);

const nextConfig: NextConfig = {
  // `npm run phone` builds into its own folder, so it can run beside a
  // normal `npm run dev` (Next allows one dev server per build folder).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The floating dev-tools badge sits bottom-left - exactly over the
  // sidebar's bottom buttons (Rename, Start navigation, Save...). A real
  // click on "Rename" opened the badge's menu instead. Build errors still
  // show as the full-screen overlay; only the badge goes.
  devIndicators: false,
  // Next.js blocks cross-origin requests to dev resources by default, and
  // treats 127.0.0.1 as a different origin from localhost. Hitting the dev
  // server by IP - which scripts/renderTour.mjs and most local tooling
  // does - otherwise warns on every page load and blocks HMR.
  //
  // The tunnel domains are for testing live GPS on a phone: geolocation
  // only works on https, and a tunnel is the simplest way to give the dev
  // server a trusted https URL (see README "Testing GPS on a phone").
  allowedDevOrigins: ["127.0.0.1", ...lanAddresses, "*.trycloudflare.com", "*.ngrok-free.app"],
};

export default nextConfig;
