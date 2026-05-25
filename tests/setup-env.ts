// Load .env into process.env so tests can pick up DATABASE_URL / TEST_DATABASE_URL
// without each test file having to call dotenv.config() itself.
//
// Tests that require a live database should still skip themselves cleanly when
// no DATABASE_URL is configured (see tests/migration.smoke.test.ts).

import 'dotenv/config';
