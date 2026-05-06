/**
 * Scenario 06 – Admin / Settings Pages Load Test
 *
 * Exercises the administrative section of the Acuo XDS Registry:
 *   • System settings page
 *   • User management
 *   • Repository/affinity domain configuration
 *   • Audit logs viewer
 *   • System health status
 *
 * NOTE: This scenario requires admin-level credentials.
 *       Set ADMIN_USERNAME / ADMIN_PASSWORD environment variables
 *       or update the ADMIN_CREDENTIALS constant below.
 *
 * Run:
 *   k6 run -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=secret k6/scenarios/06_admin_pages.js
 */

import http from 'k6/http';
import { group } from 'k6';
import { SMOKE, DEFAULT_THRESHOLDS, BASE_URL } from '../config/options.js';
import { assertSuccess, thinkTime, buildQueryString } from '../lib/helpers.js';
import { login, logout, authHeaders } from '../lib/auth.js';

const ADMIN_CREDENTIALS = {
  username: __ENV.ADMIN_USERNAME || 'admin',
  password: __ENV.ADMIN_PASSWORD || 'admin',
};

export const options = {
  // Admin scenarios are run lighter – they are sensitive operations.
  stages: SMOKE,
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    'http_req_duration{name:admin_settings}': ['p(95)<3000'],
    'http_req_duration{name:admin_users}': ['p(95)<3000'],
    'http_req_duration{name:admin_audit_log}': ['p(95)<4000'],
  },
};

export default function () {
  const { token } = login(ADMIN_CREDENTIALS);
  const headers = authHeaders(token);

  group('Admin – system settings page', () => {
    const resp = http.get(`${BASE_URL}/admin/settings`, {
      headers,
      tags: { name: 'admin_settings' },
    });
    assertSuccess(resp, 'Admin settings page', [200, 401, 403]);
    thinkTime(1, 2);
  });

  group('Admin – user management list', () => {
    const qs = buildQueryString({ page: 0, size: 20 });
    const resp = http.get(`${BASE_URL}/admin/users${qs}`, {
      headers,
      tags: { name: 'admin_users' },
    });
    assertSuccess(resp, 'Admin users list', [200, 401, 403]);
    thinkTime(1, 2);
  });

  group('Admin – affinity domain / repository configuration', () => {
    const resp = http.get(`${BASE_URL}/admin/repositories`, {
      headers,
      tags: { name: 'admin_repositories' },
    });
    assertSuccess(resp, 'Admin repositories', [200, 401, 403]);
    thinkTime(1, 2);
  });

  group('Admin – audit log viewer', () => {
    const qs = buildQueryString({ page: 0, size: 50, level: 'INFO' });
    const resp = http.get(`${BASE_URL}/admin/audit-log${qs}`, {
      headers,
      tags: { name: 'admin_audit_log' },
    });
    assertSuccess(resp, 'Admin audit log', [200, 401, 403]);
    thinkTime(1, 3);
  });

  group('Admin – system health / status', () => {
    // Actuator-style health endpoint.
    const resp = http.get(`${BASE_URL}/api/actuator/health`, {
      headers,
      tags: { name: 'admin_health' },
    });
    assertSuccess(resp, 'Admin health endpoint', [200, 401, 403]);
    thinkTime(1, 2);
  });

  group('Admin – IHE transaction log', () => {
    const qs = buildQueryString({ page: 0, size: 20, transaction: 'ITI-18' });
    const resp = http.get(`${BASE_URL}/admin/transactions${qs}`, {
      headers,
      tags: { name: 'admin_transactions' },
    });
    assertSuccess(resp, 'Admin transaction log', [200, 401, 403]);
    thinkTime(1, 2);
  });

  logout();
  thinkTime(2, 5);
}
