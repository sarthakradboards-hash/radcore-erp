'use client';
// Placeholder from RAD-56; RAD-50 replaces it.
// Replaces Next's built-in page, which styles itself with style attributes that the CSP (proxy.ts) blocks. It
// replaces the root layout too, so it brings its own document, title and stylesheets.
import '../styles/tokens.css';
import '../styles/globals.css';

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en-IN">
      <head><title>Something went wrong</title></head>
      <body>
        <main>
          <h1>Something went wrong</h1>
          <p><button type="button" onClick={() => retry()}>Try again</button></p>
        </main>
      </body>
    </html>
  );
}
