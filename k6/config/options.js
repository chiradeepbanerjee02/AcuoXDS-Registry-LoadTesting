/**
 * Shared k6 load test configuration options.
 *
 * Adjust BASE_URL, credentials, and stage definitions to match
 * the target environment before running the tests.
 */

export const BASE_URL = __ENV.BASE_URL || 'https://app-acuoregistry.hyland.com';

export const CREDENTIALS = {
  username: __ENV.USERNAME || 'testuser',
  password: __ENV.PASSWORD || 'testpassword',
};

// ─── Stage presets ────────────────────────────────────────────────────────────

/** Light smoke test – quickly verify that every scenario responds at all. */
export const SMOKE = [
  { duration: '1m', target: 2 },
];

/** Average load – simulates a typical working day. */
export const AVERAGE_LOAD = [
  { duration: '2m', target: 10 },  // ramp-up
  { duration: '5m', target: 10 },  // steady state
  { duration: '1m', target: 0 },   // ramp-down
];

/** Stress test – pushes the system beyond its expected load. */
export const STRESS = [
  { duration: '2m', target: 20 },
  { duration: '5m', target: 50 },
  { duration: '2m', target: 100 },
  { duration: '5m', target: 100 },
  { duration: '2m', target: 0 },
];

/** Spike test – sudden traffic surge followed by recovery. */
export const SPIKE = [
  { duration: '1m', target: 5 },
  { duration: '30s', target: 200 },
  { duration: '2m', target: 200 },
  { duration: '1m', target: 0 },
];

/** Soak / endurance test – sustained medium load for an extended period. */
export const SOAK = [
  { duration: '5m', target: 10 },
  { duration: '30m', target: 10 },
  { duration: '5m', target: 0 },
];

// ─── Acceptance thresholds ────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS = {
  // 95 % of all requests must complete in less than 3 s
  http_req_duration: ['p(95)<3000'],
  // Less than 5 % of requests may fail
  http_req_failed: ['rate<0.05'],
};

export const STRICT_THRESHOLDS = {
  http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  http_req_failed: ['rate<0.01'],
};
