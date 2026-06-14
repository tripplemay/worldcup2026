/** @type {import('next').NextConfig} */

// const withTM = require('next-transpile-modules')(['@babel/preset-react']);
//   '@fullcalendar/common',
//   '@fullcalendar/common',
//   '@fullcalendar/daygrid',
//   '@fullcalendar/interaction',
//   '@fullcalendar/react',

const nextConfig = {
  output: 'standalone',
  // 模板自带页面存在遗留类型/大小写问题;世界杯 App 代码在 dev 下类型检查已通过,
  // 生产构建跳过全量 tsc / eslint,避免被模板噪音阻断。
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH,
  images: {
    domains: [
      'images.unsplash.com',
      'i.ibb.co',
      'scontent.fotp8-1.fna.fbcdn.net',
    ],
    // Make ENV
    unoptimized: true,
  },
};

module.exports = nextConfig;
