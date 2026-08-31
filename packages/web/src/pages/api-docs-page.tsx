/**
 * The API, browsable and callable.
 *
 * Generated from the same zod schemas that validate every request, so it cannot
 * drift from what the server actually accepts — the reason it is worth having
 * at all rather than a document somebody keeps up to date by hand.
 *
 * Swagger UI is loaded on demand. It is around a megabyte of JavaScript, and
 * the people this application exists for are printing labels, not reading
 * schemas; bundling it into the first paint would make every one of them pay
 * for a page they will never open. `React.lazy` puts it in a chunk of its own.
 *
 * "Try it out" really does call the running service. That is the point, and it
 * is no more power than curl already has: this service has no authentication,
 * so every one of these endpoints was already open to anyone who can reach the
 * port. What changes is that they are now discoverable.
 */
import { Suspense, lazy } from 'react'
import { copy } from '../i18n/index.ts'
import { Alert } from '../components/ui/alert.tsx'

/** The document the console reads, and the one to point other tools at. */
const OPENAPI_URL = '/api/openapi.json'

const SwaggerUI = lazy(async () => {
  // The stylesheet ships with the package and is only wanted on this page.
  await import('swagger-ui-react/swagger-ui.css')
  // Corrections to it, in the same chunk so they are never paid for by
  // somebody who does not open this page. See the file for what and why.
  await import('./api-docs.css')
  return import('swagger-ui-react')
})

export function ApiDocsPage(): React.JSX.Element {
  return (
    <div className="space-y-3" data-testid="api-docs">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{copy.apiDocs.heading}</h2>
        <p className="text-2xs text-muted-foreground">
          {copy.apiDocs.explain}{' '}
          <a className="underline" href={OPENAPI_URL} target="_blank" rel="noopener noreferrer">
            {OPENAPI_URL}
          </a>
        </p>
      </div>

      {/* Said plainly, because the buttons below submit real jobs to real
          printers and consume real stock. */}
      <Alert variant="warning" className="text-xs">
        {copy.apiDocs.liveWarning}
      </Alert>

      <Suspense
        fallback={<p className="text-xs text-muted-foreground">{copy.apiDocs.loading}</p>}
      >
        <SwaggerUI url={OPENAPI_URL} />
      </Suspense>
    </div>
  )
}
