# AcuoXDS-Registry-LoadTesting

Load Testing project for the **Hyland Acuo XDS Registry** (`https://app-acuoregistry.hyland.com`).

Tests are written with [k6](https://k6.io/) and designed to run on a **self-hosted GitHub Actions runner** that has direct network access to the registry instance.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start (local)](#quick-start-local)
- [Scenarios](#scenarios)
- [Configuration](#configuration)
- [GitHub Actions](#github-actions)
- [Results](#results)

---

## Project Structure

```
.
├── .github/
│   └── workflows/
│       └── load-test.yml       # CI workflow (self-hosted runner)
└── k6/
    ├── config/
    │   └── options.js          # Shared stage presets & thresholds
    ├── lib/
    │   ├── auth.js             # Login / logout helpers
    │   └── helpers.js          # Assertions, think-time, test-data generators
    └── scenarios/
        ├── 01_login.js         # Login page (render + submit)
        ├── 02_dashboard.js     # Dashboard & widgets
        ├── 03_study_search.js  # Study search & pagination
        ├── 04_patient_search.js# Patient search & detail
        ├── 05_document_registry.js  # IHE XDS ITI-18 registry queries + REST API
        ├── 06_admin_pages.js   # Admin / settings (requires admin credentials)
        ├── 07_reports.js       # Reports & analytics
        └── 08_full_journey.js  # End-to-end user journey (primary scenario)
```

---

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| [k6](https://k6.io/docs/getting-started/installation/) | 0.54.0 | See below |

### Install k6 on Linux

```bash
K6_VERSION=0.54.0
curl -fsSL \
  "https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-v${K6_VERSION}-linux-amd64.deb" \
  -o /tmp/k6.deb
sudo dpkg -i /tmp/k6.deb
k6 version
```

### Install k6 on macOS

```bash
brew install k6
```

---

## Quick Start (local)

```bash
# Clone the repository
git clone https://github.com/chiradeepbanerjee02/AcuoXDS-Registry-LoadTesting.git
cd AcuoXDS-Registry-LoadTesting

# Run a smoke test of the full user journey
k6 run \
  -e BASE_URL=https://app-acuoregistry.hyland.com \
  -e USERNAME=testuser \
  -e PASSWORD=secret \
  k6/scenarios/08_full_journey.js

# Run a specific scenario
k6 run -e BASE_URL=https://app-acuoregistry.hyland.com k6/scenarios/03_study_search.js

# Run under stress-test load profile
k6 run -e STAGES=stress k6/scenarios/08_full_journey.js
```

---

## Scenarios

| # | File | Description | Default stages |
|---|------|-------------|----------------|
| 01 | `01_login.js` | Login page render + credential submission | Average load |
| 02 | `02_dashboard.js` | Dashboard page + summary stats, activity, notifications | Average load |
| 03 | `03_study_search.js` | Study search by patient, modality, date range + pagination | Average load |
| 04 | `04_patient_search.js` | Patient search by name, ID, DOB + detail + documents | Average load |
| 05 | `05_document_registry.js` | IHE ITI-18 SOAP queries + REST document API | Average load |
| 06 | `06_admin_pages.js` | Admin settings, users, repositories, audit log, health | Smoke |
| 07 | `07_reports.js` | Reports landing, volume, trend, error summary, CSV export | Average load |
| 08 | `08_full_journey.js` | Complete end-to-end user session (primary scenario) | Average load |

### Stage Presets

| Preset | Description | VUs |
|--------|-------------|-----|
| `smoke` | Quick sanity check | 2 VUs × 1 min |
| `average` | Typical working-day traffic | Ramp to 10 VUs over 8 min |
| `stress` | Beyond expected peak | Ramp to 100 VUs |
| `spike` | Sudden traffic surge | 5 → 200 VUs spike |
| `soak` | Sustained endurance run | 10 VUs × 30 min |

---

## Configuration

All scenarios read the following environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `https://app-acuoregistry.hyland.com` | Registry base URL |
| `USERNAME` | `testuser` | Test account username |
| `PASSWORD` | `testpassword` | Test account password |
| `ADMIN_USERNAME` | `admin` | Admin account username (scenario 06) |
| `ADMIN_PASSWORD` | `admin` | Admin account password (scenario 06) |
| `STAGES` | *(per scenario)* | Override stage preset: `smoke`, `average`, `stress`, `spike`, `soak` |

---

## GitHub Actions

The workflow (`.github/workflows/load-test.yml`) runs on a **self-hosted runner** so it has direct network access to the registry.

### Required secrets

Add these in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `LOAD_TEST_PASSWORD` | Password for the regular test account |
| `LOAD_TEST_ADMIN_USERNAME` | Admin username (scenario 06) |
| `LOAD_TEST_ADMIN_PASSWORD` | Admin password (scenario 06) |

### Manual trigger

1. Go to **Actions → Acuo XDS Registry – Load Tests → Run workflow**
2. Choose the scenario, base URL, and stage preset
3. Click **Run workflow**

Results are uploaded as a workflow artifact (`k6-results-<run-id>`) and retained for 30 days.

---

## Results

Raw k6 JSON output is written to `k6/results/` (excluded from version control via `.gitignore`).

To visualise results locally, pipe output to the k6 web dashboard:

```bash
k6 run --out web-dashboard k6/scenarios/08_full_journey.js
# Open http://localhost:5665 in your browser
```

Or send metrics to Grafana / InfluxDB:

```bash
k6 run --out influxdb=http://localhost:8086/k6 k6/scenarios/08_full_journey.js
```
