// In GitHub Codespaces the port tunnel serves the app as localhost:3000 while the proxy forwards the
// *.app.github.dev host, so Server Actions' same-origin (CSRF) check fails. Trust those origins there only.
const codespaceOrigins = process.env.CODESPACES === 'true'
  ? ['localhost:3000', `*.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev'}`]
  : []

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Per the Next.js PWA guide: the service worker must never be served stale.
  async headers() {
    return [{
      source: '/sw.js',
      headers: [
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    }]
  },
  experimental: {
    serverActions: {
      allowedOrigins: codespaceOrigins,
    },
  },
}

export default nextConfig
