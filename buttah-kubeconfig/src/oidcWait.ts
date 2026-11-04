import {
  clearStoredResult,
  OIDC_MESSAGE_SOURCE,
  type OidcPending,
  type OidcResult,
  readStoredResult,
  takeOidcCode,
} from './oidc';

/** Wait for the public client's redirect to post the authorization code back. */
export function waitForOidc(pending: OidcPending, popup: Window | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, code?: string) => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      clearStoredResult();
      if (error) {
        reject(error);
      } else if (code) {
        resolve(code);
      }
    };
    const consider = (result: OidcResult | null) => {
      if (!result) {
        return;
      }
      try {
        finish(undefined, takeOidcCode(pending, result));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Sign-in failed.'));
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data as OidcResult;
      if (!data || data.source !== OIDC_MESSAGE_SOURCE) {
        return;
      }
      consider(data);
    };
    window.addEventListener('message', onMessage);
    const timer = window.setInterval(() => {
      consider(readStoredResult());
      if (popup && popup.closed) {
        const late = readStoredResult();
        if (late) {
          consider(late);
          return;
        }
        finish(new Error('Sign-in was closed before it finished.'));
      }
    }, 300);
    const timeout = window.setTimeout(() => {
      finish(new Error('Sign-in timed out. Start again.'));
    }, 5 * 60 * 1000);
  });
}
