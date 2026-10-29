import { defineConfig } from 'vitest/config'

// Integration tests drive the real CorelDRAW installed on this machine. Run with: npm run test:corel
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    setupFiles: ['tests/setup.ts']
  }
})
