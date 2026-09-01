import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Tests run against package *sources* (not dist) so `npm test` needs no build step.
 * `test/packaging.test.ts` separately asserts that the published `exports` maps and
 * built artifacts line up, so this alias cannot hide a broken package.
 *
 * Tests that need a DOM opt in per file with `// @vitest-environment jsdom`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@reviewkit/core': src('./packages/core/src/index.ts'),
      '@reviewkit/react': src('./packages/react/src/index.ts'),
      '@reviewkit/adapter-openai-agents': src('./packages/adapter-openai-agents/src/index.ts'),
      '@reviewkit/adapter-langgraph': src('./packages/adapter-langgraph/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx', 'test/**/*.test.ts'],
    globals: false,
    setupFiles: ['./test/setup.ts'],
  },
});
