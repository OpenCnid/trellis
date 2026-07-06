import { config as dotenvConfig, type DotenvConfigOutput } from 'dotenv';

/**
 * Loads local development values before the Zod configuration boundary.
 * dotenv's default non-overriding behavior keeps shell/Compose values
 * authoritative.
 */
export function loadEnvironmentFile(
  path = '.env',
  processEnv: Record<string, string> = process.env as Record<string, string>
): DotenvConfigOutput {
  return dotenvConfig({ path, processEnv });
}

loadEnvironmentFile();
