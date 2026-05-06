/**
 * Scenario 01 – Login Page Load Test
 *
 * Exercises the Acuo XDS Registry login page under increasing concurrency.
 * Tests both the page render (GET) and credential submission (POST).
 *
 * Run:
 *   k6 run k6/scenarios/01_login.js
 *
 * Override target URL:
 *   k6 run -e BASE_URL=https://your-instance.hyland.com k6/scenarios/01_login.js
 */

import http from 'k6/http';
import { group, sleep } from 'k6';
import { AVERAGE_LOAD, DEFAULT_THRESHOLDS, BASE_URL, CREDENTIALS } from '../config/options.js';
import { assertSuccess, thinkTime, errorCount } from '../lib/helpers.js';
import { login, logout } from '../lib/auth.js';

export const options = {
  stages: AVERAGE_LOAD,
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    // Login page itself must respond quickly.
    'http_req_duration{name:login_page}': ['p(95)<2000'],
    // Credential submission can take slightly longer (server-side auth).
    'http_req_duration{name:login_submit}': ['p(95)<4000'],
    error_count: ['count<50'],
  },
};

export default function () {
  group('Login page – render', () => {
    const resp = http.get(`${BASE_URL}/login`, {
      tags: { name: 'login_page' },
    });
    assertSuccess(resp, 'Login page');
    thinkTime(1, 2);
  });

  group('Login – submit credentials', () => {
    const { success } = login(CREDENTIALS);
    if (success) {
      thinkTime(1, 3);
      logout();
    }
  });

  thinkTime(2, 5);
}
