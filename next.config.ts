import type { NextConfig } from 'next';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';

// Extra hosts allowed to call Server Actions (log in, checkout, ...) when the app is reached through a
// proxy or tunnel, e.g. "*.devtunnels.ms,localhost:3000". Next.js rejects other cross-origin calls (CSRF).
const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  // pdfkit reads its font metrics from disk, so it must not be bundled.
  serverExternalPackages: ['pdfkit'],
  // Fonts for PDF receipts and reports are read at runtime.
  outputFileTracingIncludes: {
    '/api/**/*': ['./assets/pdf-fonts/**/*', './public/assets/logo.png'],
  },
  images: {
    remotePatterns: [new URL(`${supabaseUrl}/storage/v1/object/public/**`)],
  },
  // Let `next dev` serve its live-reload connection to the same trusted hosts.
  allowedDevOrigins: trustedOrigins,
  experimental: {
    // Menu photos are resized in the browser, but allow some headroom for the upload action.
    serverActions: { bodySizeLimit: '5mb', allowedOrigins: trustedOrigins },
  },
};

export default nextConfig;
