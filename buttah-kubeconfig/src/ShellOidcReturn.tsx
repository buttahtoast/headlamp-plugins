import { useEffect, useState } from 'react';
import { OIDC_MESSAGE_SOURCE, OIDC_RESULT_KEY, readStoredPending } from './oidc';

/**
 * Public redirect target for the shell's authorization-code flow.
 * The code is posted back to the opener and removed from the address bar.
 * It is not rendered.
 */
export function ShellOidcReturn() {
  const [message, setMessage] = useState('Finishing sign-in…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = {
      source: OIDC_MESSAGE_SOURCE,
      state: params.get('state') ?? '',
      code: params.get('code') ?? undefined,
      error: params.get('error') ?? undefined,
      description: params.get('error_description') ?? undefined,
      createdAt: Date.now(),
    };
    window.history.replaceState({}, '', window.location.pathname);
    try {
      localStorage.setItem(OIDC_RESULT_KEY, JSON.stringify(result));
    } catch {
      setMessage('The browser blocked storing the sign-in response.');
      return;
    }
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(result, window.location.origin);
      window.close();
      setMessage('Signed in. You can close this window.');
      return;
    }
    const pending = readStoredPending();
    if (pending?.returnUrl) {
      window.location.replace(pending.returnUrl);
      return;
    }
    setMessage(
      result.error
        ? 'Sign-in did not finish. Return to the console and try again.'
        : 'Return to the console. The shell will continue there.'
    );
  }, []);

  return (
    <section className="buttah" aria-label="Shell sign-in">
      <h1>Shell sign-in</h1>
      <p>{message}</p>
    </section>
  );
}
