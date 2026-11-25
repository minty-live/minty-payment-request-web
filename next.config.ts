import type { NextConfig } from "next";
import { copyPdfjsAssets } from "@minty/shared/next";

// pdf.js's worker, cMaps and fonts into /public/pdfjs (gitignored), served same-origin for
// @minty/shared/pdfPreview. Here because Node evaluates this file at the start of dev and build.
copyPdfjsAssets();

/**
 * Sent with every response (the URL security round, 2026-10-05). Same values in minty-web,
 * minty-payment-request-web and minty-onboarding-web, and in Flask (pettycash/core/http_hardening.py).
 * - Referrer-Policy same-origin: another site never sees a path or query from here (tokens).
 * - frame-ancestors / X-Frame-Options: only this app may frame its pages (clickjacking).
 * - HSTS in production builds only; a browser ignores it over plain http anyway.
 */
const securityHeaders = [
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : []),
];

const nextConfig: NextConfig = {
  /**
   * @minty/shared ships .ts/.tsx SOURCE, not a build (modernisation_plan.md Part 3 step 4), so
   * Next compiles it with this app's own toolchain. Without this the build fails on the first
   * .ts file under node_modules - loudly, unlike the Tailwind scan, which fails silently (see
   * the @source line in app/globals.css).
   */
  transpilePackages: ["@minty/shared"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  /** Slightly smaller responses; security-through-obscurity only. */
  poweredByHeader: false,
  /**
   * The plain-named variables this app reads, inlined at build time into the client bundle,
   * the server and middleware.ts. Raw values only ("" when unset - Next skips an undefined
   * key, leaving `process.env.X` un-inlined); defaults and the trailing-slash strip live in
   * lib/env.ts. MAINTENANCE_SHOW_NEW_LINK is the maintenance page's optional footer flag.
   */
  env: {
    ACCOUNTS_API_URL: process.env.ACCOUNTS_API_URL ?? "",
    PAYMENT_REQUEST_API_URL: process.env.PAYMENT_REQUEST_API_URL ?? "",
    SUBSCRIPTION_API_URL: process.env.SUBSCRIPTION_API_URL ?? "",
    MAINTENANCE_SHOW_NEW_LINK: process.env.MAINTENANCE_SHOW_NEW_LINK ?? "",
  },
  /** `next upgrade --agent` reads this: security releases only (2026-11-23, 16.4.2 → 16.4.6). */
  experimental: { agentUpgrade: "security" },
};

export default nextConfig;
