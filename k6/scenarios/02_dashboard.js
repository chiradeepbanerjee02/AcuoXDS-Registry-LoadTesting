/**
 * Scenario 02 – Dashboard / Home Page Load Test
 *
 * After a successful login, exercises the main dashboard of the
 * Acuo XDS Registry.  The dashboard typically renders:
 *   • Recent activity widgets
 *   • Quick-access navigation tiles
 *   • Summary statistics (document counts, pending submissions, errors)
 *
 * Run:
 *   k6 run k6/scenarios/02_dashboard.js
 */

import http from 'k6/http';
import { group } from 'k6';
import { AVERAGE_LOAD, DEFAULT_THRESHOLDS, BASE_URL } from '../config/options.js';
import { assertSuccess, thinkTime } from '../lib/helpers.js';
import { login, logout, authHeaders } from '../lib/auth.js';

export const options = {
  stages: AVERAGE_LOAD,
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    'http_req_duration{name:dashboard}': ['p(95)<2500'],
    'http_req_duration{name:dashboard_stats}': ['p(95)<1500'],
  },
};

export default function () {
  // Each virtual user authenticates once per iteration.
  const { token } = login();
  const headers = authHeaders(token);

  group('Dashboard – main page', () => {
    const resp = http.get(`${BASE_URL}/dashboard`, {
      headers,
      tags: { name: 'dashboard' },
    });
    assertSuccess(resp, 'Dashboard');
    thinkTime(1, 2);
  });

  group('Dashboard – summary statistics API', () => {
    // Acuo Registry surfaces aggregate counts via a REST endpoint.
    const resp = http.get(`${BASE_URL}/api/v1/stats/summary`, {
      headers,
      tags: { name: 'dashboard_stats' },
    });
    assertSuccess(resp, 'Dashboard stats', [200, 401, 403]);
    thinkTime(1, 2);
  });

  group('Dashboard – recent activity feed', () => {
    const resp = http.get(`${BASE_URL}/api/v1/activity/recent?limit=20`, {
      headers,
      tags: { name: 'dashboard_activity' },
    });
    assertSuccess(resp, 'Dashboard activity', [200, 401, 403]);
    thinkTime(1, 3);
  });

  group('Dashboard – notifications', () => {
    const resp = http.get(`${BASE_URL}/api/v1/notifications?unread=true`, {
      headers,
      tags: { name: 'dashboard_notifications' },
    });
    assertSuccess(resp, 'Dashboard notifications', [200, 401, 403]);
  });

  logout();
  thinkTime(2, 5);
}
