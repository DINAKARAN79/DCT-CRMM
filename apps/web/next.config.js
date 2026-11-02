/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  transpilePackages: ['@dct-crm/db', '@dct-crm/shared'],
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      'zod$': require.resolve('zod'),
    };
    return config;
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async headers() {
    const configuredDialpadUrl = new URL(process.env.DIALPAD_URL || 'https://bizcall.cxteletech.com/embed/dialpad');
    if (process.env.NODE_ENV === 'production' && configuredDialpadUrl.protocol !== 'https:') {
      throw new Error('DIALPAD_URL must use HTTPS in production.');
    }
    const dialpadOrigin = configuredDialpadUrl.origin;
    return [{
      source: '/:path*',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: `frame-src 'self' ${dialpadOrigin}`,
        },
        {
          key: 'Permissions-Policy',
          value: `microphone=(self "${dialpadOrigin}")`,
        },
      ],
    }];
  },
};

module.exports = nextConfig;
