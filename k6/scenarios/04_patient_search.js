/**
 * Scenario 04 – Patient Search Page Load Test
 *
 * Simulates users searching for patients in the Acuo XDS Registry.
 * Exercises:
 *   • Patient search page render
 *   • Search by patient name
 *   • Search by patient ID / MRN
 *   • Search by date of birth
 *   • View patient details and associated documents
 *
 * Run:
 *   k6 run k6/scenarios/04_patient_search.js
 */

import http from 'k6/http';
import { group } from 'k6';
import { AVERAGE_LOAD, DEFAULT_THRESHOLDS, BASE_URL } from '../config/options.js';
import {
  assertSuccess,
  thinkTime,
  buildQueryString,
  randomPatientId,
  randomFrom,
} from '../lib/helpers.js';
import { login, logout, authHeaders } from '../lib/auth.js';

// Sample patient search terms to vary the load.
const PATIENT_NAMES = [
  'Smith',
  'Jones',
  'Williams',
  'Taylor',
  'Brown',
];

const DATES_OF_BIRTH = [
  '1975-06-15',
  '1982-11-03',
  '1990-04-22',
  '1968-09-30',
  '2001-01-17',
];

export const options = {
  stages: AVERAGE_LOAD,
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    'http_req_duration{name:patient_search_page}': ['p(95)<2000'],
    'http_req_duration{name:patient_search_results}': ['p(95)<3000'],
    'http_req_duration{name:patient_detail}': ['p(95)<2500'],
  },
};

export default function () {
  const { token } = login();
  const headers = authHeaders(token);

  group('Patient search – page render', () => {
    const resp = http.get(`${BASE_URL}/patients`, {
      headers,
      tags: { name: 'patient_search_page' },
    });
    assertSuccess(resp, 'Patient search page');
    thinkTime(1, 2);
  });

  group('Patient search – search by family name', () => {
    const lastName = randomFrom(PATIENT_NAMES);
    const qs = buildQueryString({ lastName, page: 0, size: 20 });
    const resp = http.get(`${BASE_URL}/api/v1/patients${qs}`, {
      headers,
      tags: { name: 'patient_search_results' },
    });
    assertSuccess(resp, 'Patient search by name', [200, 401, 403, 404]);
    thinkTime(1, 2);
  });

  group('Patient search – search by patient ID (MRN)', () => {
    const patientId = randomPatientId();
    const qs = buildQueryString({ patientId, page: 0, size: 20 });
    const resp = http.get(`${BASE_URL}/api/v1/patients${qs}`, {
      headers,
      tags: { name: 'patient_search_results' },
    });
    assertSuccess(resp, 'Patient search by ID', [200, 401, 403, 404]);
    thinkTime(1, 3);
  });

  group('Patient search – search by date of birth', () => {
    const dob = randomFrom(DATES_OF_BIRTH);
    const qs = buildQueryString({ dateOfBirth: dob, page: 0, size: 20 });
    const resp = http.get(`${BASE_URL}/api/v1/patients${qs}`, {
      headers,
      tags: { name: 'patient_search_results' },
    });
    assertSuccess(resp, 'Patient search by DOB', [200, 401, 403, 404]);
    thinkTime(1, 2);
  });

  group('Patient search – view patient detail & documents', () => {
    const patientId = randomPatientId();

    // Patient detail page.
    const detailResp = http.get(`${BASE_URL}/patients/${patientId}`, {
      headers,
      tags: { name: 'patient_detail' },
    });
    assertSuccess(detailResp, 'Patient detail page', [200, 401, 403, 404]);
    thinkTime(1, 2);

    // Documents associated with the patient.
    const docsResp = http.get(
      `${BASE_URL}/api/v1/patients/${patientId}/documents?page=0&size=20`,
      {
        headers,
        tags: { name: 'patient_documents' },
      },
    );
    assertSuccess(docsResp, 'Patient documents', [200, 401, 403, 404]);
    thinkTime(1, 3);
  });

  logout();
  thinkTime(2, 5);
}
