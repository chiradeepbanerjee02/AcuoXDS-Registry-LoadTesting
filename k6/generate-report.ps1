#Requires -Version 5.1

<#
.SYNOPSIS
    Generates an HTML load-test report from k6 summary JSON files.

.DESCRIPTION
    Reads every *_summary.json file produced by k6 --summary-export that is
    found under the results directory, extracts the key performance metrics and
    threshold results, and writes a self-contained Reports.html file styled to
    match the Hyland Acuo test-report conventions used across the Acuo toolchain.

.PARAMETER ResultsDir
    Directory that contains the k6 *_summary.json files.
    Defaults to "k6/results" relative to the script location.

.PARAMETER OutputPath
    Full path (including filename) for the generated HTML report.
    Defaults to "k6/results/load-test-report.html" relative to the script location.

.PARAMETER BaseUrl
    Target base URL that was used during the run.  Shown in the report header.

.PARAMETER StagesPreset
    Load-stage preset name (smoke / average / stress / spike / soak).
    Shown in the report header.

.EXAMPLE
    .\k6\generate-report.ps1

.EXAMPLE
    .\k6\generate-report.ps1 -ResultsDir "k6/results" -StagesPreset "stress"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ResultsDir = "",

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = "",

    [Parameter(Mandatory = $false)]
    [string]$BaseUrl = "",

    [Parameter(Mandatory = $false)]
    [string]$StagesPreset = ""
)

$ErrorActionPreference = "Stop"

# ── Resolve paths ─────────────────────────────────────────────────────────────

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

if (-not $ResultsDir) {
    $ResultsDir = Join-Path $scriptDir "results"
}
if (-not (Split-Path -IsAbsolute $ResultsDir)) {
    $ResultsDir = Join-Path (Get-Location).Path $ResultsDir
}

if (-not $OutputPath) {
    $OutputPath = Join-Path $ResultsDir "load-test-report.html"
}
if (-not (Split-Path -IsAbsolute $OutputPath)) {
    $OutputPath = Join-Path (Get-Location).Path $OutputPath
}

if (-not $BaseUrl)      { $BaseUrl      = $env:BASE_URL       ?? "https://app-acuoregistry.hyland.com" }
if (-not $StagesPreset) { $StagesPreset = $env:STAGES         ?? "smoke" }

Write-Host "Results directory : $ResultsDir"
Write-Host "Output report     : $OutputPath"

# ── Friendly scenario labels ──────────────────────────────────────────────────

$scenarioLabels = @{
    "01_login"             = "Login Page"
    "02_dashboard"         = "Dashboard"
    "03_study_search"      = "Study Search"
    "04_patient_search"    = "Patient Search"
    "05_document_registry" = "Document Registry (ITI-18)"
    "06_admin_pages"       = "Admin Pages"
    "07_reports"           = "Reports & Analytics"
    "08_full_journey"      = "Full User Journey"
}

# ── Collect summary files ─────────────────────────────────────────────────────

$summaryFiles = Get-ChildItem -Path $ResultsDir -Filter "*_summary.json" -ErrorAction SilentlyContinue |
                Sort-Object Name

if ($summaryFiles.Count -eq 0) {
    Write-Warning "No *_summary.json files found in '$ResultsDir'. Report will be empty."
}

# ── Parse each summary file ───────────────────────────────────────────────────

function Get-MetricValue {
    param($Metric, [string]$Key, [double]$Default = 0)
    if ($null -eq $Metric) { return $Default }
    $v = $Metric.values
    if ($null -eq $v) { $v = $Metric }
    $val = $v.$Key
    if ($null -eq $val) { return $Default }
    return [double]$val
}

function Get-ThresholdStatus {
    param($MetricObj)
    if ($null -eq $MetricObj -or $null -eq $MetricObj.thresholds) { return $null }
    foreach ($tKey in $MetricObj.thresholds.PSObject.Properties.Name) {
        $t = $MetricObj.thresholds.$tKey
        if ($t.ok -eq $false) { return $false }
    }
    return $true
}

$scenarios = @()

foreach ($file in $summaryFiles) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    # Strip trailing _summary
    $scenarioKey = $baseName -replace '_summary$', ''

    $label = if ($scenarioLabels.ContainsKey($scenarioKey)) {
        $scenarioLabels[$scenarioKey]
    } else {
        ($scenarioKey -replace '_', ' ') -replace '^\d+\s*', ''
    }

    try {
        $json = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
    } catch {
        Write-Warning "Could not parse $($file.Name): $_"
        continue
    }

    $metrics = $json.metrics

    # ── HTTP request metrics ──────────────────────────────────────────────────
    $httpReqs     = $metrics."http_reqs"
    $httpDuration = $metrics."http_req_duration"
    $httpFailed   = $metrics."http_req_failed"
    $checksMetric = $metrics."checks"
    $iterations   = $metrics."iterations"

    $totalRequests = [int](Get-MetricValue $httpReqs     "count")
    $requestRate   = [math]::Round((Get-MetricValue $httpReqs "rate"), 2)
    $failRate      = [math]::Round((Get-MetricValue $httpFailed "rate") * 100, 2)
    $avgDuration   = [math]::Round((Get-MetricValue $httpDuration "avg"),  1)
    $p95Duration   = [math]::Round((Get-MetricValue $httpDuration "p(95)"), 1)
    $p99Duration   = [math]::Round((Get-MetricValue $httpDuration "p(99)"), 1)
    $maxDuration   = [math]::Round((Get-MetricValue $httpDuration "max"),   1)
    $minDuration   = [math]::Round((Get-MetricValue $httpDuration "min"),   1)
    $medDuration   = [math]::Round((Get-MetricValue $httpDuration "med"),   1)
    $checkPasses   = [int](Get-MetricValue $checksMetric "passes")
    $checkFails    = [int](Get-MetricValue $checksMetric "fails")
    $totalIter     = [int](Get-MetricValue $iterations   "count")

    # ── Threshold evaluation ──────────────────────────────────────────────────
    # A scenario passes when ALL defined thresholds pass.
    $allThresholdsOk = $true
    $thresholdRows   = @()

    foreach ($mName in $metrics.PSObject.Properties.Name) {
        $mObj = $metrics.$mName
        if ($null -eq $mObj.thresholds) { continue }
        foreach ($tExpr in $mObj.thresholds.PSObject.Properties.Name) {
            $tOk = $mObj.thresholds.$tExpr.ok
            if ($tOk -eq $false) { $allThresholdsOk = $false }
            $thresholdRows += [PSCustomObject]@{
                Metric     = $mName
                Expression = $tExpr
                Passed     = ($tOk -ne $false)
            }
        }
    }

    # If no thresholds found, treat as indeterminate (null) rather than pass.
    $scenarioStatus = if ($thresholdRows.Count -eq 0) { $null } else { $allThresholdsOk }

    $scenarios += [PSCustomObject]@{
        Key            = $scenarioKey
        Label          = $label
        TotalRequests  = $totalRequests
        RequestRate    = $requestRate
        FailRatePct    = $failRate
        AvgDuration    = $avgDuration
        MedDuration    = $medDuration
        MinDuration    = $minDuration
        MaxDuration    = $maxDuration
        P95Duration    = $p95Duration
        P99Duration    = $p99Duration
        CheckPasses    = $checkPasses
        CheckFails     = $checkFails
        TotalIter      = $totalIter
        ThresholdRows  = $thresholdRows
        Passed         = $scenarioStatus
    }
}

# ── Summary counts ────────────────────────────────────────────────────────────

$totalScenarios   = $scenarios.Count
$passedScenarios  = ($scenarios | Where-Object { $_.Passed -eq $true  }).Count
$failedScenarios  = ($scenarios | Where-Object { $_.Passed -eq $false }).Count
$unknownScenarios = ($scenarios | Where-Object { $null -eq $_.Passed  }).Count

$overallOk = ($failedScenarios -eq 0)

# ── HTML generation ───────────────────────────────────────────────────────────

function Format-Ms { param([double]$ms) return "$ms ms" }
function Format-Pct { param([double]$pct) return "$pct %" }

$generatedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"

# Build threshold rows HTML for the detail modal
function Build-ThresholdHtml {
    param([array]$Rows)
    if ($Rows.Count -eq 0) { return "<p style='color:#888;font-style:italic'>No thresholds defined.</p>" }
    $h = "<table style='width:100%;border-collapse:collapse;font-size:12px'>"
    $h += "<tr><th style='text-align:left;padding:4px 8px;background:#003B71;color:white'>Metric</th>"
    $h += "<th style='text-align:left;padding:4px 8px;background:#003B71;color:white'>Threshold</th>"
    $h += "<th style='text-align:center;padding:4px 8px;background:#003B71;color:white'>Result</th></tr>"
    foreach ($row in $Rows) {
        $icon  = if ($row.Passed) { "&#10003;" } else { "&#10007;" }
        $color = if ($row.Passed) { "#28a745"  } else { "#dc3545"  }
        $h += "<tr>"
        $h += "<td style='padding:4px 8px;border-bottom:1px solid #e9ecef;font-family:monospace'>$($row.Metric)</td>"
        $h += "<td style='padding:4px 8px;border-bottom:1px solid #e9ecef;font-family:monospace'>$($row.Expression)</td>"
        $h += "<td style='padding:4px 8px;border-bottom:1px solid #e9ecef;text-align:center;font-weight:600;color:$color'>$icon</td>"
        $h += "</tr>"
    }
    $h += "</table>"
    return $h
}

# Scenario table rows
$tableRows = ""
$modalContent = ""
$rowIndex = 0

foreach ($s in $scenarios) {
    $rowIndex++

    $statusText  = if ($null -eq $s.Passed) { "N/A" } elseif ($s.Passed) { "&#10003; PASS" } else { "&#10007; FAIL" }
    $statusClass = if ($null -eq $s.Passed) { "status-na" } elseif ($s.Passed) { "status-success" } else { "status-failed" }

    $checksTotal = $s.CheckPasses + $s.CheckFails
    $checksText  = if ($checksTotal -gt 0) {
        "$($s.CheckPasses) / $checksTotal"
    } else { "N/A" }
    $checksClass = if ($s.CheckFails -gt 0) { "status-failed" } else { "status-success" }

    $errorClass  = if ($s.FailRatePct -gt 0) { "status-failed" } else { "status-success" }

    $thresholdModalId = "threshold-modal-$rowIndex"
    $tHtml = Build-ThresholdHtml $s.ThresholdRows
    $modalContent += @"
<div id="$thresholdModalId" class="modal-overlay" onclick="closeAllModals()">
    <div class="modal-content" onclick="event.stopPropagation()">
        <div class="modal-header">
            <h3>Thresholds &mdash; $($s.Label)</h3>
            <button class="close-btn" onclick="closeAllModals()" title="Close">&times;</button>
        </div>
        <div style="overflow:auto;max-height:55vh;margin-top:10px">
            $tHtml
        </div>
        <div class="button-group" style="margin-top:15px">
            <button class="copy-btn" onclick="closeAllModals()">Close</button>
        </div>
    </div>
</div>
"@

    $thresholdCell = if ($s.ThresholdRows.Count -gt 0) {
        "<a href='#' class='token-link' onclick=""showModal('$thresholdModalId');return false;"">View ($($s.ThresholdRows.Count))</a>"
    } else {
        "<span class='token-na'>None</span>"
    }

    $tableRows += @"
<tr>
    <td>$rowIndex</td>
    <td><strong>$($s.Label)</strong></td>
    <td>$($s.TotalIter)</td>
    <td>$($s.TotalRequests)</td>
    <td>$($s.RequestRate) req/s</td>
    <td class="$errorClass">$(Format-Pct $s.FailRatePct)</td>
    <td>$(Format-Ms $s.AvgDuration)</td>
    <td>$(Format-Ms $s.MedDuration)</td>
    <td>$(Format-Ms $s.P95Duration)</td>
    <td>$(Format-Ms $s.P99Duration)</td>
    <td class="$checksClass">$checksText</td>
    <td>$thresholdCell</td>
    <td class="$statusClass">$statusText</td>
</tr>
"@
}

if ($scenarios.Count -eq 0) {
    $tableRows = "<tr><td colspan='13' style='text-align:center;padding:30px;color:#888;font-style:italic'>No scenario results found in the results directory.</td></tr>"
}

# ── Full HTML document ────────────────────────────────────────────────────────

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Acuo XDS Registry &ndash; Load Test Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #eef3f8;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='110' height='110' viewBox='0 0 110 110'><g fill='none' stroke='%23c9d6e3' stroke-width='1' opacity='0.45'><path d='M5 60 H24 L30 40 L40 82 L50 30 L60 70 L68 60 H100'/></g><g fill='%23dbe5ef' opacity='0.5'><path d='M76 18 H86 V28 H96 V38 H86 V48 H76 V38 H66 V28 H76 Z'/></g></svg>");
            background-attachment: fixed;
            color: #333;
        }
        .report-header {
            background: linear-gradient(135deg, #003B71 0%, #0073CF 100%);
            color: white;
            padding: 24px 40px;
            display: flex;
            align-items: center;
            gap: 20px;
            position: relative;
            overflow: hidden;
        }
        .report-header::before {
            content: '';
            position: absolute;
            inset: 0;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 120'><g fill='none' stroke='white' stroke-width='1.2' opacity='0.13'><path d='M0 60 H80 L92 28 L106 92 L120 18 L134 80 L146 60 H600'/></g></svg>");
            background-repeat: no-repeat;
            background-position: center right;
            background-size: cover;
            pointer-events: none;
        }
        .report-header > * { position: relative; z-index: 1; }
        .header-text { flex: 1; min-width: 0; }
        .header-meta { display: flex; gap: 24px; margin-top: 8px; flex-wrap: wrap; }
        .header-meta-item { font-size: 12px; opacity: 0.85; }
        .header-meta-item strong { font-weight: 700; }
        .health-illustration {
            height: 78px;
            flex-shrink: 0;
            margin-left: auto;
        }
        .feature-strip {
            display: flex;
            gap: 14px;
            padding: 18px 30px;
            background: linear-gradient(180deg, #f5f9fc 0%, #ffffff 100%);
            border-bottom: 1px solid #e3eaf1;
            flex-wrap: wrap;
        }
        .feature-chip {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: white;
            border: 1px solid #d6e2ec;
            border-left: 4px solid #0073CF;
            border-radius: 8px;
            flex: 1;
            min-width: 220px;
            box-shadow: 0 1px 4px rgba(0,59,113,0.06);
        }
        .feature-chip svg { width: 30px; height: 30px; flex-shrink: 0; color: #0073CF; }
        .feature-chip-text strong { display: block; color: #003B71; font-size: 13px; font-weight: 700; letter-spacing: 0.3px; }
        .feature-chip-text span { font-size: 11px; color: #5a6772; }
        .summary-icon { width: 38px; height: 38px; margin: 0 auto 6px; display: block; color: #003B71; }
        .summary-icon.success-icon { color: #28a745; }
        .summary-icon.failed-icon  { color: #dc3545; }
        .summary-icon.unknown-icon { color: #6c757d; }
        .footer-icons { display: inline-flex; gap: 6px; vertical-align: middle; margin-right: 8px; color: #0073CF; }
        .footer-icons svg { width: 14px; height: 14px; }
        .hyland-logo { height: 40px; }
        .header-divider { width: 2px; height: 40px; background-color: rgba(255,255,255,0.4); }
        .header-title { font-size: 22px; font-weight: 600; letter-spacing: 0.5px; }
        .header-subtitle { font-size: 13px; opacity: 0.85; margin-top: 2px; }
        .container { max-width: 1600px; margin: 30px auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden; }
        .content { padding: 30px; }
        .summary {
            display: flex;
            justify-content: center;
            gap: 40px;
            margin: 0 0 30px 0;
            padding: 20px;
            background-color: #f8f9fa;
            border-radius: 6px;
            border: 1px solid #e9ecef;
        }
        .summary-item { text-align: center; min-width: 120px; }
        .summary-item .number { font-size: 36px; font-weight: 700; }
        .summary-item .label { color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
        .success { color: #28a745; }
        .failed  { color: #dc3545; }
        .total   { color: #003B71; }
        .unknown { color: #6c757d; }
        .table-wrapper { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; min-width: 900px; }
        th {
            background-color: #003B71;
            color: white;
            padding: 12px 10px;
            text-align: left;
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
        }
        td { padding: 11px 10px; border-bottom: 1px solid #e9ecef; font-size: 13px; vertical-align: middle; }
        tr:hover { background-color: #f8f9fa; }
        .status-success { color: #28a745; font-weight: 600; }
        .status-failed  { color: #dc3545; font-weight: 600; }
        .status-na      { color: #6c757d; font-style: italic; }
        .token-link {
            color: #0073CF;
            text-decoration: none;
            font-weight: 600;
            cursor: pointer;
            padding: 3px 9px;
            border: 1px solid #0073CF;
            border-radius: 4px;
            font-size: 12px;
            transition: all 0.2s ease;
            display: inline-block;
            white-space: nowrap;
        }
        .token-link:hover { background-color: #0073CF; color: white; }
        .token-na { color: #999; font-style: italic; }
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.5);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .modal-content {
            background: white;
            border-radius: 8px;
            padding: 30px;
            max-width: 700px;
            width: 90%;
            max-height: 80vh;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            position: relative;
        }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #003B71; }
        .modal-header h3 { color: #003B71; font-size: 18px; }
        .close-btn { font-size: 24px; cursor: pointer; color: #666; border: none; background: none; padding: 0 5px; line-height: 1; }
        .close-btn:hover { color: #dc3545; }
        .copy-btn { padding: 8px 20px; background-color: #003B71; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600; transition: background-color 0.2s ease; }
        .copy-btn:hover { background-color: #0073CF; }
        .button-group { display: flex; align-items: center; gap: 10px; }
        .footer { background-color: #f8f9fa; border-top: 1px solid #e9ecef; padding: 15px 30px; text-align: center; color: #888; font-size: 12px; }
        .overall-banner {
            padding: 10px 30px;
            font-size: 14px;
            font-weight: 600;
            text-align: center;
            letter-spacing: 0.3px;
        }
        .overall-banner.pass { background: #d4edda; color: #155724; border-bottom: 1px solid #c3e6cb; }
        .overall-banner.fail { background: #f8d7da; color: #721c24; border-bottom: 1px solid #f5c6cb; }
        .overall-banner.na   { background: #e2e3e5; color: #383d41; border-bottom: 1px solid #d6d8db; }
        .section-title { font-size: 16px; font-weight: 600; color: #003B71; margin-bottom: 16px; }
    </style>
</head>
<body>
<div class="container">

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="report-header">
        <svg class="hyland-logo" viewBox="0 0 180 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Hyland Logo">
            <text x="0" y="32" font-family="'Segoe UI', Arial, sans-serif" font-size="32" font-weight="700" fill="white" letter-spacing="4">HYLAND</text>
        </svg>
        <div class="header-divider"></div>
        <div class="header-text">
            <div class="header-title">Acuo XDS Registry &ndash; Load Test Report</div>
            <div class="header-subtitle">Generated: $generatedAt</div>
            <div class="header-meta">
                <div class="header-meta-item"><strong>Target:</strong> $BaseUrl</div>
                <div class="header-meta-item"><strong>Stage preset:</strong> $StagesPreset</div>
                <div class="header-meta-item"><strong>Scenarios run:</strong> $totalScenarios</div>
            </div>
        </div>
        <svg class="health-illustration" viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Healthcare VNA illustration">
            <path d="M0 52 H50 L58 30 L68 72 L78 18 L88 62 L96 52 H120" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            <g transform="translate(135,20)">
                <rect width="50" height="50" rx="10" fill="rgba(255,255,255,0.95)"/>
                <path d="M19 8 H31 V19 H42 V31 H31 V42 H19 V31 H8 V19 H19 Z" fill="#0073CF"/>
            </g>
            <g transform="translate(210,18)">
                <rect width="60" height="14" rx="3" fill="rgba(255,255,255,0.92)"/>
                <rect y="20" width="60" height="14" rx="3" fill="rgba(255,255,255,0.92)"/>
                <rect y="40" width="60" height="14" rx="3" fill="rgba(255,255,255,0.92)"/>
                <circle cx="8" cy="7"  r="2.2" fill="#0073CF"/>
                <circle cx="8" cy="27" r="2.2" fill="#0073CF"/>
                <circle cx="8" cy="47" r="2.2" fill="#28a745"/>
                <text x="30" y="76" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="10" font-weight="700" fill="rgba(255,255,255,0.92)" letter-spacing="2">VNA</text>
            </g>
        </svg>
    </div>

    <!-- ── Overall pass/fail banner ────────────────────────────────────────── -->
$(
    if ($failedScenarios -gt 0) {
        "    <div class=""overall-banner fail"">&#10007;&nbsp; $failedScenarios scenario(s) breached one or more thresholds &mdash; review the table below.</div>"
    } elseif ($totalScenarios -gt 0 -and $unknownScenarios -eq $totalScenarios) {
        "    <div class=""overall-banner na"">&#9432;&nbsp; No thresholds were defined &mdash; pass/fail status is unavailable.</div>"
    } elseif ($passedScenarios -gt 0) {
        "    <div class=""overall-banner pass"">&#10003;&nbsp; All $passedScenarios scenario(s) with thresholds passed successfully.</div>"
    } else {
        "    <div class=""overall-banner na"">&#9432;&nbsp; No scenarios were executed.</div>"
    }
)

    <!-- ── Feature chips ───────────────────────────────────────────────────── -->
    <div class="feature-strip">
        <div class="feature-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12h4l2-5 4 10 2-5h6"/>
            </svg>
            <div class="feature-chip-text">
                <strong>k6 Load Testing</strong>
                <span>Grafana k6 &middot; Performance &amp; Scalability</span>
            </div>
        </div>
        <div class="feature-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <path d="M3 9h18M8 5v14"/>
                <circle cx="14.5" cy="13.5" r="2.2"/>
            </svg>
            <div class="feature-chip-text">
                <strong>IHE XDS Registry</strong>
                <span>ITI-18 Registry Stored Query &middot; XDS.b</span>
            </div>
        </div>
        <div class="feature-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/>
                <path d="M9 12l2 2 4-4"/>
            </svg>
            <div class="feature-chip-text">
                <strong>Threshold Validation</strong>
                <span>P95 Latency &middot; Error Rate &middot; Check Pass Rate</span>
            </div>
        </div>
    </div>

    <!-- ── Summary counts ──────────────────────────────────────────────────── -->
    <div class="content">
        <div class="summary">
            <div class="summary-item">
                <svg class="summary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="5" y="3" width="14" height="18" rx="2"/>
                    <path d="M9 3h6v3H9z" fill="currentColor" fill-opacity="0.18" stroke="none"/>
                    <path d="M9 11h6M9 15h6M9 7h6"/>
                </svg>
                <div class="number total">$totalScenarios</div>
                <div class="label">Total Scenarios</div>
            </div>
            <div class="summary-item">
                <svg class="summary-icon success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" fill="currentColor" fill-opacity="0.12"/>
                    <path d="M8 12l3 3 5-6"/>
                </svg>
                <div class="number success">$passedScenarios</div>
                <div class="label">Passed</div>
            </div>
            <div class="summary-item">
                <svg class="summary-icon failed-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 3l10 17H2L12 3z" fill="currentColor" fill-opacity="0.12"/>
                    <path d="M12 10v5"/>
                    <circle cx="12" cy="18" r="0.8" fill="currentColor"/>
                </svg>
                <div class="number failed">$failedScenarios</div>
                <div class="label">Failed</div>
            </div>
            <div class="summary-item">
                <svg class="summary-icon unknown-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9"/>
                    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/>
                    <circle cx="12" cy="17" r="0.6" fill="currentColor"/>
                </svg>
                <div class="number unknown">$unknownScenarios</div>
                <div class="label">No Thresholds</div>
            </div>
        </div>

        <!-- ── Results table ─────────────────────────────────────────────── -->
        <p class="section-title">Scenario Results</p>
        <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th style="width:3%">#</th>
                    <th style="width:16%">Scenario</th>
                    <th style="width:7%">Iterations</th>
                    <th style="width:7%">HTTP Reqs</th>
                    <th style="width:8%">Req Rate</th>
                    <th style="width:7%">Error %</th>
                    <th style="width:8%">Avg</th>
                    <th style="width:8%">Median</th>
                    <th style="width:8%">P95</th>
                    <th style="width:8%">P99</th>
                    <th style="width:8%">Checks (P/T)</th>
                    <th style="width:8%">Thresholds</th>
                    <th style="width:7%">Status</th>
                </tr>
            </thead>
            <tbody>
                $tableRows
            </tbody>
        </table>
        </div>
    </div>

    <!-- ── Footer ──────────────────────────────────────────────────────────── -->
    <div class="footer">
        <p>
            <span class="footer-icons">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>
            </span>
            &copy; Hyland Software &mdash; Acuo XDS Registry Load Test Report
        </p>
    </div>

</div>

<!-- ── Threshold detail modals ─────────────────────────────────────────────── -->
$modalContent

<script>
    function showModal(id) {
        var el = document.getElementById(id);
        if (el) { el.style.display = 'flex'; }
    }
    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(function(m) {
            m.style.display = 'none';
        });
    }
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { closeAllModals(); }
    });
</script>
</body>
</html>
"@

# ── Write output ──────────────────────────────────────────────────────────────

$outputDir = Split-Path -Parent $OutputPath
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

if ($PSVersionTable.PSVersion.Major -ge 6) {
    $html | Out-File -FilePath $OutputPath -Encoding utf8NoBOM
} else {
    [System.IO.File]::WriteAllText($OutputPath, $html, [System.Text.UTF8Encoding]::new($false))
}

Write-Host "`nHTML report generated: $OutputPath" -ForegroundColor Cyan
Write-Host "  Scenarios : $totalScenarios  (Passed: $passedScenarios  Failed: $failedScenarios  No-threshold: $unknownScenarios)"
