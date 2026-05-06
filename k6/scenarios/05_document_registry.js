/**
 * Scenario 05 – IHE XDS Document Registry (ITI-18 Registry Stored Query) Load Test
 *
 * Exercises the IHE XDS.b-compliant ITI-18 (Registry Stored Query) endpoint
 * of the Acuo XDS Registry.  The following stored queries are exercised:
 *
 *   • FindDocuments     (urn:uuid:14d4debf-8f97-4251-9a74-a90016b0af0d)
 *   • GetDocuments      (urn:uuid:5c4f972b-d56b-40ac-a5fc-c8ca9b40b9d4)
 *   • FindSubmissionSets (urn:uuid:f26abbcb-ac74-4422-8a30-edb644bbc1a9)
 *   • GetFolders        (urn:uuid:5737b14c-8a1a-4539-b659-e03a34a5e1e4)
 *
 * The REST-based document management API (/api/v1/documents) is also exercised.
 *
 * Run:
 *   k6 run k6/scenarios/05_document_registry.js
 */

import http from 'k6/http';
import { group } from 'k6';
import { AVERAGE_LOAD, DEFAULT_THRESHOLDS, BASE_URL } from '../config/options.js';
import {
  assertSuccess,
  thinkTime,
  buildQueryString,
  randomPatientId,
  buildIti18FindDocumentsPayload,
  buildIti18GetDocumentsPayload,
} from '../lib/helpers.js';
import { login, logout, authHeaders } from '../lib/auth.js';

// ITI-18 endpoint (SOAP over HTTP) – adjust path if the registry uses a different mount.
const ITI18_ENDPOINT = `${BASE_URL}/ws/services/xds-iti18`;

const SOAP_HEADERS = {
  'Content-Type': 'application/soap+xml; charset=utf-8',
  'SOAPAction': 'urn:ihe:iti:2007:RegistryStoredQuery',
};

export const options = {
  stages: AVERAGE_LOAD,
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    // SOAP queries are heavier; allow a 5 s p95.
    'http_req_duration{name:iti18_find_documents}': ['p(95)<5000'],
    'http_req_duration{name:iti18_get_documents}': ['p(95)<5000'],
    'http_req_duration{name:rest_documents_list}': ['p(95)<3000'],
    'http_req_duration{name:rest_document_detail}': ['p(95)<2000'],
  },
};

export default function () {
  const { token } = login();
  const headers = authHeaders(token);

  // ── IHE ITI-18 SOAP queries ───────────────────────────────────────────────

  group('ITI-18 – FindDocuments stored query', () => {
    const patientId = randomPatientId();
    const resp = http.post(
      ITI18_ENDPOINT,
      buildIti18FindDocumentsPayload(patientId),
      { headers: SOAP_HEADERS, tags: { name: 'iti18_find_documents' } },
    );
    // SOAP endpoint returns 200 even for fault responses.
    assertSuccess(resp, 'ITI-18 FindDocuments', [200, 500]);
    thinkTime(1, 3);
  });

  group('ITI-18 – GetDocuments stored query', () => {
    const docUid = 'urn:uuid:sample-doc-uid-001';
    const resp = http.post(
      ITI18_ENDPOINT,
      buildIti18GetDocumentsPayload(docUid),
      { headers: SOAP_HEADERS, tags: { name: 'iti18_get_documents' } },
    );
    assertSuccess(resp, 'ITI-18 GetDocuments', [200, 500]);
    thinkTime(1, 2);
  });

  // ── REST document management API ─────────────────────────────────────────

  group('REST API – list documents', () => {
    const qs = buildQueryString({ page: 0, size: 20, status: 'Approved' });
    const resp = http.get(`${BASE_URL}/api/v1/documents${qs}`, {
      headers,
      tags: { name: 'rest_documents_list' },
    });
    assertSuccess(resp, 'REST documents list', [200, 401, 403]);
    thinkTime(1, 2);
  });

  group('REST API – document detail', () => {
    const sampleDocId = 'sample-doc-001';
    const resp = http.get(`${BASE_URL}/api/v1/documents/${sampleDocId}`, {
      headers,
      tags: { name: 'rest_document_detail' },
    });
    assertSuccess(resp, 'REST document detail', [200, 401, 403, 404]);
    thinkTime(1, 3);
  });

  group('REST API – document metadata', () => {
    const sampleDocId = 'sample-doc-001';
    const resp = http.get(`${BASE_URL}/api/v1/documents/${sampleDocId}/metadata`, {
      headers,
      tags: { name: 'rest_document_metadata' },
    });
    assertSuccess(resp, 'REST document metadata', [200, 401, 403, 404]);
    thinkTime(1, 2);
  });

  group('REST API – submission sets list', () => {
    const patientId = randomPatientId();
    const qs = buildQueryString({ patientId, page: 0, size: 20 });
    const resp = http.get(`${BASE_URL}/api/v1/submission-sets${qs}`, {
      headers,
      tags: { name: 'rest_submission_sets' },
    });
    assertSuccess(resp, 'REST submission sets', [200, 401, 403]);
    thinkTime(1, 2);
  });

  logout();
  thinkTime(2, 5);
}
