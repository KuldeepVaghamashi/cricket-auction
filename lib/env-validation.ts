/**
 * Runtime checks for production deployments. Called from instrumentation (Node) and server.ts.
 * Does not alter request UX — fails fast at boot with a clear message if misconfigured.
 */
export function validateProductionEnvironment(): void {
  if (process.env.NODE_ENV !== "production") return;

  const mongo = process.env.MONGODB_URI?.trim();
  if (!mongo) {
    throw new Error("MONGODB_URI must be set in production.");
  }

  const jwt = process.env.JWT_SECRET?.trim();
  if (!jwt || jwt.length < 32) {
    throw new Error(
      "JWT_SECRET must be set in production to a random string of at least 32 characters."
    );
  }
}
