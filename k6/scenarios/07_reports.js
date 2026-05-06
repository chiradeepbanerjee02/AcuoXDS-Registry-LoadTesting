/**
 * Scenario 07 – Reports & Analytics Page Load Test
 *
 * Exercises the reporting section of the Acuo XDS Registry:
 *   • Reports landing page
 *   • Document volume report
 *   • Submission trend report
 *   • Error / rejection report
 *   • Report export (CSV download trigger)
 *
 * Run:
 *   k6 run k6/scenarios/07_reports.js
 */

import http from 'k6/http';
import { group } from 'k6';
import { AVERAGE_LOAD, DEFAULT_THRESHOLDS, BASE_URL } from '../config/options.js';
import { assertSuccess, thinkTime, buildQueryString } from '../lib/helpers.js';
import { login, logout, authHeaders } from '../lib/auth.js';

export const options = {
  stages: AVERAGE_LOAD,
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    // Reports involve aggregations – allow up to 5 s p95.
    'http_req_duration{name:reports_page}': ['p(95)<3000'],
    'http_req_duration{name:report_document_volume}': ['p(95)<5000'],
    'http_req_duration{name:report_submission_trend}': ['p(95)<5000'],
    'http_req_duration{name:report_error_summary}': ['p(95)<5000'],
  },
};

export default function () {
  const { token } = login();
  const headers = authHeaders(token);

  group('Reports – landing page', () => {
    const resp = http.get(`${BASE_URL}/reports`, {
      headers,
      tags: { name: 'reports_page' },
    });
    assertSuccess(resp, 'Reports landing page');
    thinkTime(1, 2);
  });

  group('Reports – document volume (last 30 days)', () => {
    const qs = buildQueryString({
      reportType: 'documentVolume',
      from: '2024-01-01',
      to: '2024-12-31',
      groupBy: 'day',
    });
    const resp = http.get(`${BASE_URL}/api/v1/reports/document-volume${qs}`, {
      headers,
      tags: { name: 'report_document_volume' },
    });
    assertSuccess(resp, 'Report: document volume', [200, 401, 403]);
    thinkTime(2, 4);
  });

  group('Reports – submission trend', () => {
    const qs = buildQueryString({
      from: '2024-01-01',
      to: '2024-12-31',
      groupBy: 'week',
    });
    const resp = http.get(`${BASE_URL}/api/v1/reports/submission-trend${qs}`, {
      headers,
      tags: { name: 'report_submission_trend' },
    });
    assertSuccess(resp, 'Report: submission trend', [200, 401, 403]);
    thinkTime(2, 3);
  });

  group('Reports – error and rejection summary', () => {
    const qs = buildQueryString({
      from: '2024-01-01',
      to: '2024-12-31',
    });
    const resp = http.get(`${BASE_URL}/api/v1/reports/error-summary${qs}`, {
      headers,
      tags: { name: 'report_error_summary' },
    });
    assertSuccess(resp, 'Report: error summary', [200, 401, 403]);
    thinkTime(1, 3);
  });

  group('Reports – export to CSV (trigger only, no download)', () => {
    const qs = buildQueryString({
      reportType: 'documentVolume',
      from: '2024-01-01',
      to: '2024-12-31',
      format: 'csv',
    });
    const resp = http.get(`${BASE_URL}/api/v1/reports/export${qs}`, {
      headers,
      tags: { name: 'report_export_csv' },
    });
    // Export may return 200 (inline) or 202 (accepted / async generation).
    assertSuccess(resp, 'Report: CSV export', [200, 202, 401, 403]);
    thinkTime(2, 4);
  });

  logout();
  thinkTime(2, 5);
}
