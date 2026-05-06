/**
 * Scenario 03 – Study Search Page Load Test
 *
 * Simulates users searching for imaging studies in the Acuo XDS Registry.
 * Exercises:
 *   • Page render
 *   • Search by patient ID
 *   • Search by modality
 *   • Search by date range
 *   • Paginated results navigation
 *
 * Run:
 *   k6 run k6/scenarios/03_study_search.js
 */

import http from 'k6/http';
import { group } from 'k6';
import { AVERAGE_LOAD, DEFAULT_THRESHOLDS, BASE_URL } from '../config/options.js';
import {
  assertSuccess,
  thinkTime,
  buildQueryString,
  randomPatientId,
  randomModality,
} from '../lib/helpers.js';
import { login, logout, authHeaders } from '../lib/auth.js';

export const options = {
  stages: AVERAGE_LOAD,
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    'http_req_duration{name:study_search_page}': ['p(95)<2000'],
    'http_req_duration{name:study_search_results}': ['p(95)<3000'],
    'http_req_duration{name:study_search_paginate}': ['p(95)<2000'],
  },
};

export default function () {
  const { token } = login();
  const headers = authHeaders(token);

  group('Study search – page render', () => {
    const resp = http.get(`${BASE_URL}/studies`, {
      headers,
      tags: { name: 'study_search_page' },
    });
    assertSuccess(resp, 'Study search page');
    thinkTime(1, 2);
  });

  group('Study search – search by patient ID', () => {
    const patientId = randomPatientId();
    const qs = buildQueryString({ patientId, page: 0, size: 20 });
    const resp = http.get(`${BASE_URL}/api/v1/studies${qs}`, {
      headers,
      tags: { name: 'study_search_results' },
    });
    assertSuccess(resp, 'Study search by patient ID', [200, 401, 403, 404]);
    thinkTime(1, 3);
  });

  group('Study search – filter by modality', () => {
    const modality = randomModality();
    const qs = buildQueryString({ modality, page: 0, size: 20 });
    const resp = http.get(`${BASE_URL}/api/v1/studies${qs}`, {
      headers,
      tags: { name: 'study_search_results' },
    });
    assertSuccess(resp, 'Study search by modality', [200, 401, 403, 404]);
    thinkTime(1, 2);
  });

  group('Study search – filter by date range', () => {
    const qs = buildQueryString({
      studyDateFrom: '20240101',
      studyDateTo: '20241231',
      page: 0,
      size: 20,
    });
    const resp = http.get(`${BASE_URL}/api/v1/studies${qs}`, {
      headers,
      tags: { name: 'study_search_results' },
    });
    assertSuccess(resp, 'Study search by date range', [200, 401, 403, 404]);
    thinkTime(1, 2);
  });

  group('Study search – paginate to page 2', () => {
    const qs = buildQueryString({ page: 1, size: 20 });
    const resp = http.get(`${BASE_URL}/api/v1/studies${qs}`, {
      headers,
      tags: { name: 'study_search_paginate' },
    });
    assertSuccess(resp, 'Study search page 2', [200, 401, 403, 404]);
    thinkTime(1, 3);
  });

  group('Study search – view study details', () => {
    // Navigate to a known/sample study UID detail page.
    const sampleStudyId = 'sample-study-001';
    const resp = http.get(`${BASE_URL}/studies/${sampleStudyId}`, {
      headers,
      tags: { name: 'study_detail' },
    });
    assertSuccess(resp, 'Study detail page', [200, 401, 403, 404]);
    thinkTime(2, 4);
  });

  logout();
  thinkTime(2, 5);
}
