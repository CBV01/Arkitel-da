const nextConfig = {
  async rewrites() {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const normalized = base.replace(/\/$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${normalized}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
