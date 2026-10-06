import { fileURLToPath } from 'node:url';
export default {
 // Viteのキャッシュをリポジトリ直下に作らない
 cacheDir: fileURLToPath(new URL('../../apps/ui/node_modules/.vite-eval', import.meta.url)),
 resolve: { alias: {
  'next/headers': fileURLToPath(new URL('../../apps/ui/node_modules/next/headers.js', import.meta.url)),
  'next/navigation': fileURLToPath(new URL('../../apps/ui/node_modules/next/navigation.js', import.meta.url)),
  'vitest': fileURLToPath(new URL('../../apps/ui/node_modules/vitest/dist/index.js', import.meta.url)),
  '@': fileURLToPath(new URL('../../apps/ui/src', import.meta.url)),
  'server-only': fileURLToPath(new URL('../../apps/ui/test/mocks/server-only.ts', import.meta.url)),
 } },
 test: { include: ['evaluations/ai_security/*.test.ts'], environment: 'node' },
};
