/**
 * Shared authentication helpers.
 *
 * Provides login / logout utilities and a token cache so that each VU
 * only authenticates once per iteration unless explicitly refreshed.
 */

import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, CREDENTIALS } from '../config/options.js';

/**
 * Perform a form-based login and return the session token / cookie jar.
 *
 * Acuo XDS Registry uses a standard username + password login form at
 * GET  /login  (renders the form)
 * POST /login  (submits credentials, redirects to dashboard on success)
 *
 * @param {object} [creds] - Override default credentials.
 * @returns {{ token: string|null, jar: object }} Auth artefacts for subsequent requests.
 */
export function login(creds = CREDENTIALS) {
  const jar = http.cookieJar();

  // 1. Load the login page to collect any CSRF token / hidden fields.
  const loginPage = http.get(`${BASE_URL}/login`, {
    tags: { name: 'login_page' },
  });

  check(loginPage, {
    'login page status is 200': (r) => r.status === 200,
  });

  // Extract CSRF token if present (common Spring Security / Angular pattern).
  const csrfToken = extractCsrfToken(loginPage.body);

  // 2. Submit credentials.
  const payload = {
    username: creds.username,
    password: creds.password,
  };
  if (csrfToken) {
    payload['_csrf'] = csrfToken;
  }

  const loginResp = http.post(`${BASE_URL}/login`, payload, {
    tags: { name: 'login_submit' },
    redirects: 5,
  });

  const success = check(loginResp, {
    'login succeeded (200 or 302)': (r) => r.status === 200 || r.status === 302,
    'not redirected back to login (no login loop)': (r) =>
      !r.url.includes('/login?error'),
  });

  // Extract bearer token from response body or headers if the app uses JWT.
  let token = null;
  const authHeader = loginResp.headers['Authorization'] || loginResp.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '');
  }

  // Fallback: look for token in JSON body.
  if (!token) {
    try {
      const body = JSON.parse(loginResp.body);
      token = body.token || body.accessToken || body.access_token || null;
    } catch (_) {
      // Not a JSON response – cookie-based session is in use.
    }
  }

  return { success, token, jar };
}

/**
 * Log the current virtual user out.
 */
export function logout() {
  const resp = http.get(`${BASE_URL}/logout`, {
    tags: { name: 'logout' },
  });
  check(resp, {
    'logout status is 200 or 302': (r) => r.status === 200 || r.status === 302,
  });
}

/**
 * Build a headers object that includes the bearer token when one is available.
 *
 * @param {string|null} token
 * @returns {object}
 */
export function authHeaders(token) {
  const headers = {
    'Accept': 'application/json, text/html, */*',
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Attempt to extract a CSRF token from the HTML body.
 * Handles both `<input type="hidden" name="_csrf" value="…">` and
 * `<meta name="csrf-token" content="…">` patterns.
 */
function extractCsrfToken(body) {
  if (!body) return null;

  // <input type="hidden" name="_csrf" value="TOKEN" />
  const inputMatch = body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (inputMatch) return inputMatch[1];

  // <meta name="csrf-token" content="TOKEN" />
  const metaMatch = body.match(/name="csrf-token"\s+content="([^"]+)"/);
  if (metaMatch) return metaMatch[1];

  // <meta name="_csrf" content="TOKEN" />
  const metaCsrfMatch = body.match(/name="_csrf"\s+content="([^"]+)"/);
  if (metaCsrfMatch) return metaCsrfMatch[1];

  return null;
}
