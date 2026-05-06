/**
 * Scenario 08 – Full End-to-End User Journey Load Test
 *
 * Simulates a complete, realistic user session in the Acuo XDS Registry:
 *
 *   1. Navigate to the login page
 *   2. Authenticate
 *   3. Review the dashboard summary
 *   4. Search for a patient
 *   5. Open the patient's study list
 *   6. Browse study details
 *   7. Run a document registry query (ITI-18 FindDocuments)
 *   8. View a document's metadata
 *   9. Open the reports section
 *  10. Log out
 *
 * This is the primary scenario for evaluating the overall system capacity
 * and identifying bottlenecks under realistic concurrent usage patterns.
 *
 * Run:
 *   k6 run k6/scenarios/08_full_journey.js
 *
 * Stress test:
 *   k6 run -e STAGES=stress k6/scenarios/08_full_journey.js
 */

import http from 'k6/http';
import { group } from 'k6';
import {
  AVERAGE_LOAD,
  STRESS,
  DEFAULT_THRESHOLDS,
  BASE_URL,
} from '../config/options.js';
import {
  assertSuccess,
  thinkTime,
  buildQueryString,
  randomPatientId,
  randomModality,
  buildIti18FindDocumentsPayload,
} from '../lib/helpers.js';
import { login, logout, authHeaders } from '../lib/auth.js';

// Allow the stage preset to be overridden via the STAGES env var.
const STAGES_PRESET = __ENV.STAGES === 'stress' ? STRESS : AVERAGE_LOAD;

export const options = {
  stages: STAGES_PRESET,
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    // Individual page SLOs.
    'http_req_duration{name:login_page}': ['p(95)<2000'],
    'http_req_duration{name:dashboard}': ['p(95)<2500'],
    'http_req_duration{name:patient_search_results}': ['p(95)<3000'],
    'http_req_duration{name:study_list}': ['p(95)<3000'],
    'http_req_duration{name:study_detail}': ['p(95)<2500'],
    'http_req_duration{name:iti18_find_documents}': ['p(95)<5000'],
    'http_req_duration{name:document_metadata}': ['p(95)<2000'],
    'http_req_duration{name:reports_page}': ['p(95)<3000'],
  },
};

export default function () {

  // ── Step 1 – Visit login page ─────────────────────────────────────────────
  group('Step 1: Login page', () => {
    const resp = http.get(`${BASE_URL}/login`, {
      tags: { name: 'login_page' },
    });
    assertSuccess(resp, 'Login page');
    thinkTime(1, 2);
  });

  // ── Step 2 – Authenticate ─────────────────────────────────────────────────
  const { token } = login();
  const headers = authHeaders(token);

  // ── Step 3 – Dashboard ────────────────────────────────────────────────────
  group('Step 3: Dashboard', () => {
    const resp = http.get(`${BASE_URL}/dashboard`, {
      headers,
      tags: { name: 'dashboard' },
    });
    assertSuccess(resp, 'Dashboard');

    // Load dashboard widgets in parallel (simulates browser parallel requests).
    const batchResponses = http.batch([
      {
        method: 'GET',
        url: `${BASE_URL}/api/v1/stats/summary`,
        params: { headers, tags: { name: 'dashboard_stats' } },
      },
      {
        method: 'GET',
        url: `${BASE_URL}/api/v1/activity/recent?limit=10`,
        params: { headers, tags: { name: 'dashboard_activity' } },
      },
      {
        method: 'GET',
        url: `${BASE_URL}/api/v1/notifications?unread=true`,
        params: { headers, tags: { name: 'dashboard_notifications' } },
      },
    ]);

    batchResponses.forEach((r, i) => {
      assertSuccess(r, `Dashboard widget ${i}`, [200, 401, 403]);
    });

    thinkTime(2, 4);
  });

  // ── Step 4 – Patient search ────────────────────────────────────────────────
  group('Step 4: Patient search', () => {
    const patientId = randomPatientId();
    const qs = buildQueryString({ patientId, page: 0, size: 10 });
    const resp = http.get(`${BASE_URL}/api/v1/patients${qs}`, {
      headers,
      tags: { name: 'patient_search_results' },
    });
    assertSuccess(resp, 'Patient search', [200, 401, 403, 404]);
    thinkTime(1, 3);
  });

  // ── Step 5 – Study list for the patient ───────────────────────────────────
  group('Step 5: Study list', () => {
    const patientId = randomPatientId();
    const modality = randomModality();
    const qs = buildQueryString({ patientId, modality, page: 0, size: 10 });
    const resp = http.get(`${BASE_URL}/api/v1/studies${qs}`, {
      headers,
      tags: { name: 'study_list' },
    });
    assertSuccess(resp, 'Study list', [200, 401, 403, 404]);
    thinkTime(1, 2);
  });

  // ── Step 6 – Study detail ─────────────────────────────────────────────────
  group('Step 6: Study detail', () => {
    const sampleStudyId = 'sample-study-001';
    const resp = http.get(`${BASE_URL}/studies/${sampleStudyId}`, {
      headers,
      tags: { name: 'study_detail' },
    });
    assertSuccess(resp, 'Study detail', [200, 401, 403, 404]);
    thinkTime(2, 4);
  });

  // ── Step 7 – IHE ITI-18 document registry query ───────────────────────────
  group('Step 7: ITI-18 FindDocuments', () => {
    const patientId = randomPatientId();
    const resp = http.post(
      `${BASE_URL}/ws/services/xds-iti18`,
      buildIti18FindDocumentsPayload(patientId),
      {
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'SOAPAction': 'urn:ihe:iti:2007:RegistryStoredQuery',
        },
        tags: { name: 'iti18_find_documents' },
      },
    );
    assertSuccess(resp, 'ITI-18 FindDocuments', [200, 500]);
    thinkTime(1, 3);
  });

  // ── Step 8 – Document metadata ────────────────────────────────────────────
  group('Step 8: Document metadata', () => {
    const sampleDocId = 'sample-doc-001';
    const resp = http.get(`${BASE_URL}/api/v1/documents/${sampleDocId}/metadata`, {
      headers,
      tags: { name: 'document_metadata' },
    });
    assertSuccess(resp, 'Document metadata', [200, 401, 403, 404]);
    thinkTime(1, 2);
  });

  // ── Step 9 – Reports page ─────────────────────────────────────────────────
  group('Step 9: Reports page', () => {
    const resp = http.get(`${BASE_URL}/reports`, {
      headers,
      tags: { name: 'reports_page' },
    });
    assertSuccess(resp, 'Reports page', [200, 401, 403]);
    thinkTime(2, 4);
  });

  // ── Step 10 – Logout ──────────────────────────────────────────────────────
  group('Step 10: Logout', () => {
    logout();
  });

  thinkTime(3, 6);
}
