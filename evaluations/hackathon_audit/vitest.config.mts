import { fileURLToPath } from 'node:url';
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default {
  cacheDir: r('../../apps/ui/node_modules/.vite-eval'),
  resolve: { alias: {
    'next/headers': r('../../apps/ui/node_modules/next/headers.js'),
    'next/navigation': r('../../apps/ui/node_modules/next/navigation.js'),
    'next/server': r('../../apps/ui/node_modules/next/server.js'),
    'vitest': r('../../apps/ui/node_modules/vitest/dist/index.js'),
    '@': r('../../apps/ui/src'),
    'server-only': r('../../apps/ui/test/mocks/server-only.ts'),
  } },
  test: { include: ['evaluations/hackathon_audit/*.test.ts'], environment: 'node', fileParallelism: false, testTimeout: 30000 },
};
