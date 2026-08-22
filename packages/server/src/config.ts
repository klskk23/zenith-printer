/**
 * Settings that come from the deployment rather than from the database.
 *
 * The settings page says it plainly: server configuration is decided by how the
 * service is deployed and is not offered in the UI. This service has no
 * authentication and listens on every interface, so an endpoint that accepted a
 * private key would hand one to anybody on the network.
 */

/**
 * Path to the Google service-account key, or `undefined` when none is set.
 *
 * Absent is a normal state, not an error: the rest of the application works
 * without it, and the UI simply does not offer to link a spreadsheet (FR-005).
 */
export function googleCredentialsPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = env.ZENITH_GOOGLE_CREDENTIALS?.trim()
  return path === undefined || path.length === 0 ? undefined : path
}
