/**
 * General-purpose helper utilities for the Acuo XDS Registry load tests.
 */

import { sleep } from 'k6';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// ─── Custom metrics ───────────────────────────────────────────────────────────

/** Response time for full page loads (HTML + all critical sub-resources). */
export const pageLoadTime = new Trend('page_load_time', true);

/** Number of times a non-2xx / 3xx response was returned. */
export const errorCount = new Counter('error_count');

// ─── Think-time helpers ───────────────────────────────────────────────────────

/**
 * Simulate a realistic user think time.
 *
 * Values are uniformly distributed between `min` and `max` seconds.
 *
 * @param {number} [min=1]
 * @param {number} [max=3]
 */
export function thinkTime(min = 1, max = 3) {
  sleep(min + Math.random() * (max - min));
}

/**
 * Short pause between consecutive lightweight requests in the same scenario
 * (e.g., API polling inside a single page).
 */
export function shortPause() {
  sleep(0.3 + Math.random() * 0.4);
}

// ─── Response validation ──────────────────────────────────────────────────────

/**
 * Assert common HTTP success conditions and increment error counters on failure.
 *
 * @param {object} response  - k6 Response object.
 * @param {string} pageName  - Human-readable label used in check names.
 * @param {number[]} [allowed] - Allowed HTTP status codes (default: 200, 201, 302).
 */
export function assertSuccess(response, pageName, allowed = [200, 201, 302]) {
  const ok = check(response, {
    [`${pageName}: status is acceptable`]: (r) => allowed.includes(r.status),
    [`${pageName}: response time < 3s`]: (r) => r.timings.duration < 3000,
  });

  if (!ok) {
    errorCount.add(1);
  }

  pageLoadTime.add(response.timings.duration, { page: pageName });
  return ok;
}

/**
 * Assert that a JSON response contains the expected fields.
 *
 * @param {object} response
 * @param {string} pageName
 * @param {string[]} fields - Top-level JSON keys that must be present.
 */
export function assertJsonFields(response, pageName, fields) {
  let body;
  try {
    body = JSON.parse(response.body);
  } catch (_) {
    check(response, {
      [`${pageName}: body is valid JSON`]: () => false,
    });
    errorCount.add(1);
    return false;
  }

  return check(body, {
    [`${pageName}: required fields present`]: (b) =>
      fields.every((f) => Object.prototype.hasOwnProperty.call(b, f)),
  });
}

// ─── URL builder ─────────────────────────────────────────────────────────────

/**
 * Build a query string from a plain object (omits undefined / null values).
 *
 * @param {object} params
 * @returns {string} – e.g. "?q=foo&page=1"
 */
export function buildQueryString(params) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// ─── Test data generators ─────────────────────────────────────────────────────

const PATIENT_IDS = [
  'P001', 'P002', 'P003', 'P004', 'P005',
  'P006', 'P007', 'P008', 'P009', 'P010',
];

const STUDY_UIDs = [
  '1.2.840.10008.5.1.4.1.1.2',
  '1.2.840.10008.5.1.4.1.1.4',
  '1.2.840.10008.5.1.4.1.1.128',
  '1.2.840.10008.5.1.4.1.1.481.1',
  '1.2.840.10008.5.1.4.1.1.7',
];

const MODALITIES = ['CT', 'MR', 'US', 'DX', 'NM', 'PT', 'CR'];

/** Return a random element from an array. */
export function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Return a random patient ID from the test data set. */
export function randomPatientId() {
  return randomFrom(PATIENT_IDS);
}

/** Return a random Study UID root from the test data set. */
export function randomStudyUID() {
  return randomFrom(STUDY_UIDs);
}

/** Return a random imaging modality. */
export function randomModality() {
  return randomFrom(MODALITIES);
}

/**
 * Generate a simple IHE XDS.b Registry Stored Query (ITI-18) payload.
 * Uses the FindDocuments query (urn:uuid:14d4debf-8f97-4251-9a74-a90016b0af0d).
 *
 * @param {string} patientId
 * @returns {string} SOAP XML string.
 */
export function buildIti18FindDocumentsPayload(patientId) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://www.w3.org/2005/08/addressing"
  xmlns:xdsb="urn:ihe:iti:xds-b:2007"
  xmlns:rs="urn:oasis:names:tc:ebxml-regrep:xsd:rs:3.0"
  xmlns:rim="urn:oasis:names:tc:ebxml-regrep:xsd:rim:3.0"
  xmlns:query="urn:oasis:names:tc:ebxml-regrep:xsd:query:3.0">
  <soapenv:Header>
    <wsa:Action>urn:ihe:iti:2007:RegistryStoredQuery</wsa:Action>
  </soapenv:Header>
  <soapenv:Body>
    <query:AdhocQueryRequest>
      <query:ResponseOption returnType="ObjectRef" returnComposedObjects="true"/>
      <rim:AdhocQuery id="urn:uuid:14d4debf-8f97-4251-9a74-a90016b0af0d">
        <rim:Slot name="$XDSDocumentEntryPatientId">
          <rim:ValueList>
            <rim:Value>'${patientId}^^^&amp;1.3.6.1.4.1.21367.2005.3.7&amp;ISO'</rim:Value>
          </rim:ValueList>
        </rim:Slot>
        <rim:Slot name="$XDSDocumentEntryStatus">
          <rim:ValueList>
            <rim:Value>('urn:oasis:names:tc:ebxml-regrep:StatusType:Approved')</rim:Value>
          </rim:ValueList>
        </rim:Slot>
      </rim:AdhocQuery>
    </query:AdhocQueryRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Generate a simple IHE XDS.b GetDocuments (ITI-18) payload.
 *
 * @param {string} docUid
 * @returns {string} SOAP XML string.
 */
export function buildIti18GetDocumentsPayload(docUid) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://www.w3.org/2005/08/addressing"
  xmlns:query="urn:oasis:names:tc:ebxml-regrep:xsd:query:3.0"
  xmlns:rim="urn:oasis:names:tc:ebxml-regrep:xsd:rim:3.0">
  <soapenv:Header>
    <wsa:Action>urn:ihe:iti:2007:RegistryStoredQuery</wsa:Action>
  </soapenv:Header>
  <soapenv:Body>
    <query:AdhocQueryRequest>
      <query:ResponseOption returnType="LeafClass" returnComposedObjects="true"/>
      <rim:AdhocQuery id="urn:uuid:5c4f972b-d56b-40ac-a5fc-c8ca9b40b9d4">
        <rim:Slot name="$XDSDocumentEntryEntryUUID">
          <rim:ValueList>
            <rim:Value>('${docUid}')</rim:Value>
          </rim:ValueList>
        </rim:Slot>
      </rim:AdhocQuery>
    </query:AdhocQueryRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}
