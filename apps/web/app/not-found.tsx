// Placeholder from RAD-56; RAD-50 replaces it.
// Replaces Next's built-in page, which styles itself with style attributes that the CSP (proxy.ts) blocks.
import Link from 'next/link';

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p><Link href="/">Go to the home page</Link></p>
    </main>
  );
}
