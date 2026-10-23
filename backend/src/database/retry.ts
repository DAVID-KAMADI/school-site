const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/**
 * Runs a transaction again when MySQL aborts it because of a deadlock, which can happen
 * when two people change the same rows at the same moment. Retries are short and bounded.
 */
export async function withDeadlockRetry<T>(
  work: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      const code =
        (err as { driverError?: { code?: string }; code?: string }).driverError
          ?.code ?? (err as { code?: string }).code;
      if (!code || !RETRYABLE.has(code) || attempt >= attempts) throw err;
      await new Promise((r) =>
        setTimeout(r, 20 * attempt + Math.random() * 30),
      );
    }
  }
}
