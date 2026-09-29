import { defineConfig } from 'vitest/config'

// `npm run test:db` (scripts/test-db.ts): the tests that need a real Postgres. The setup rebuilds the schema
// from the migrations once; the files share that database, so they run one at a time.
export default defineConfig({
  test: {
    include: ['src/**/*.db.test.ts'],
    globalSetup: ['src/test/db.setup.ts'],
    fileParallelism: false,
  },
})
