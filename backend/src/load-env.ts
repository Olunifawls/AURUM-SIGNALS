import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Candidate .env locations, resolved so the app finds the repo-root .env no
 * matter what the current working directory is (repo root, backend/, or the
 * compiled dist/ folder).
 */
export function envCandidatePaths(): string[] {
  return [
    path.resolve(__dirname, '../../.env'), // repo root from backend/dist (or backend/src via ts)
    path.resolve(process.cwd(), '.env'), // cwd/.env
    path.resolve(process.cwd(), '../.env'), // repo root when cwd = backend/
  ];
}

/**
 * Load the first .env file that exists into process.env (without overriding
 * variables already set — so Docker/CI env wins). If NO .env file exists it is
 * a no-op and returns null; it never throws. This keeps local runs working from
 * any directory while staying safe where env is injected via process.env only.
 */
export function loadRepoEnv(candidates: string[] = envCandidatePaths()): string | null {
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p });
        return p;
      }
    } catch {
      // ignore unreadable path and keep trying
    }
  }
  return null; // no .env file — rely on process.env (Docker/CI)
}
