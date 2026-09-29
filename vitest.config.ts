import { configDefaults, defineConfig } from 'vitest/config'

// `npm test`: everything but the database tests, which need a Postgres (`npm run test:db`, vitest.db.config.ts).
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '**/*.db.test.ts'] },
})
