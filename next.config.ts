import type { NextConfig } from 'next';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';

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
  experimental: {
    // Menu photos are resized in the browser, but allow some headroom for the upload action.
    serverActions: { bodySizeLimit: '5mb' },
  },
};

export default nextConfig;
