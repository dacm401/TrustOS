// workspace: 20260416214742
/**
 * Vitest setupFile — runs in each worker thread before tests are collected.
 *
 * Database initialisation (ensureTestDb + loadSchema) has been moved to
 * globalSetup (tests/db/global-setup.ts) so it only runs once before any
 * workers start.  This file is kept as a placeholder so the setupFiles
 * entry in vitest.repo.config.ts continues to resolve without error.
 */

// Nothing to do here — DB is already ready by the time workers load this file.
