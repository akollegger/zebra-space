/**
 * Loads a `.env` file into `process.env` if it exists, via Node's own `loadEnvFile` (no
 * dependency) — silently does nothing if the file is simply absent, but lets any other failure
 * (e.g. a permissions error, malformed syntax) propagate rather than swallowing it.
 *
 * Node's `loadEnvFile` never overwrites an already-set `process.env` value, so a real shell
 * export still wins over whatever `.env` contains — this only fills in what isn't already set.
 */
export function loadEnvFileIfPresent(path: string): void {
  try {
    process.loadEnvFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}
