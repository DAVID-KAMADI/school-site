# Performance assessment

**Assessment date:** 2026-11-06  
**Target:** local training environment only; no production traffic was sent.

## Executive summary

The saved mixed-journey baseline completed at 1, 10, 25, 50, 100, 150, and 200 concurrent visitors. Throughput rose to about 42 requests/s at 150 visitors and then stopped increasing at 200, while latency rose sharply. Using a provisional P95 target of 1 second (there is no project SLA), 50 users is the highest tested level that met the target. At 100 users P95 was 1.45 seconds; at 200 users it was 5.04 seconds. These are completed local test stages, not evidence that 200 users are an acceptable production capacity.

The measured database activity remained low relative to the application processes. At 200 users the API averaged 97% of one CPU core, with a sampled peak of 332%; the web process averaged 64%, while MySQL CPU rounded to 0% in the monitor. The data supports an application/web CPU bottleneck, but no CPU profile was captured to identify the specific hot function.

The saved pre-change application runs also exposed duplicate "Application received" events on double-submit, and occasional 403 responses from submit requests. All successful submissions were present in MySQL with application numbers; no lost or phantom submissions were found. The current working tree now has a row-lock/idempotency change in `ApplicationsService.submit`, but a valid post-change concurrency run was not completed.

**Before/after comparison:** unavailable. The current source builds, but no valid post-change stress run completed, so no performance or race-fix improvement is claimed.

## Architecture and application flow

- **Frontend:** Angular 22 with server-side rendering. The production Node server serves rendered pages and proxies `/api` and `/media` to the Nest API. Public pages and the programme block are CMS-driven.
- **Backend:** NestJS 12, TypeORM, MySQL 8. Public admissions options are returned by `GET /api/v1/applicant/options`. Applicant registration is `POST /api/v1/applicant/register`; applicant accounts receive a session. The shared cookie/session and CSRF controls apply to subsequent mutations. Staff authentication also requires two-step verification.
- **Application lifecycle:** `GET /api/v1/applicant/application` returns the current application and creates a draft on first access. Five section endpoints save programme, personal, next-of-kin, education, and funding data. `POST /api/v1/applicant/application/submit` validates sections, intake, declaration, and required documents, then stores status, application number, and an event. Applicants can retrieve status through the same application endpoint.
- **Documents:** `POST /api/v1/applicant/application/documents` accepts one file per request (20 MB interceptor ceiling, potentially lower per document type). The API validates file signatures, re-encodes photos with `sharp`, and stores private files on local disk with metadata in MySQL. The test fixtures are synthetic.
- **Database:** TypeORM entities and migrations create users/roles, programmes, intakes, applications, documents, and application events. Application numbers and document storage keys are unique; applications have status/name/KCSE and status/submission indexes. The database config does not specify a pool size, so the driver defaults apply.
- **Course discovery:** Public programme details appear in a CMS block. I found no public course search/filter UI or separate course-search endpoint; the saved browsing scenario requests `/courses` but does not exercise a search interaction.
- **External integrations:** The reviewed application flow records manual M-Pesa references and application events. No payment gateway, email delivery, or SMS delivery was found in the flow reviewed.

Relevant implementation and test files: [`applicant.controller.ts`](../backend/src/admissions/applicant.controller.ts), [`applications.service.ts`](../backend/src/admissions/applications.service.ts), [`application-schemas.ts`](../backend/src/admissions/application-schemas.ts), [`application.entity.ts`](../backend/src/admissions/entities/application.entity.ts), [`private-storage.ts`](../backend/src/admissions/private-storage.ts), and [`server.ts`](../frontend/src/server.ts).

## Environment and test execution

The inspected database configuration points to the local `school_site_training` database on `127.0.0.1:3309`. Saved load-test requests targeted `http://127.0.0.1:4400`; the monitor sampled the API, website, MySQL processes, DB activity, and `/health` every two seconds.

The primary saved run, [`baseline-steps.json`](./results/baseline-steps.json), ran from 2026-11-06 11:35:45Z to 11:48:10Z. Its persisted arguments specify the 1/10/25/50/100/150/200 levels, 90 seconds per level, a 65% browsing / 30% applying / 5% returning mix, think scale 0.3, 20% abandonment, 10% double-submit, and 15% slow-network simulation. Think scale 0.3 means pauses were 30% of full configured human delays, so this is a faster-than-realistic session model. The separate [`profile-100.json`](./results/profile-100.json) ran 100 users for 120 seconds.

These are existing saved local runs, not newly generated traffic in this assessment. I independently reran the integrity queries for both result files. Their timestamps precede the current submission-service edit (14:57 local), so their latency and race findings are a pre-change baseline.

Both current source builds succeeded: `npm run build` in the backend and the frontend production build. A fresh admissions E2E run could not initialize TypeORM: it failed with `DataTypeNotSupportedError: Data type "Object" in "PortalAccessLog.event" is not supported by "mysql"`. The event field is a string-literal union with no explicit database column type. The tests therefore did not reach the application flow. No E2E records were created by that failed setup.

I attempted a small post-change race check, but the expected staging ports were already occupied by processes I did not start. Requests through the development proxy also hit shared-IP rate limits, so those attempts are not included as valid measurements. The synthetic accounts created by those attempts were removed by their exact run tags; no documents were created. I did not terminate any pre-existing process.

## Mixed-journey load results

Values below are end-to-end request latency for all requests attributed to each stage. The load generator models active sessions, not one request per user per second.

| Concurrent users | Requests | Req/s | Avg ms | P50 ms | P90 ms | P95 ms | P99 ms | Max ms | Request error rate |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 45 | 0.52 | 59.2 | 44.0 | 100.9 | 117.0 | 347.1 | 347.1 | 0% |
| 10 | 271 | 3.04 | 121.4 | 66.0 | 340.5 | 404.6 | 618.8 | 715.8 | 0% |
| 25 | 810 | 9.05 | 134.1 | 69.3 | 312.9 | 449.1 | 1,290.3 | 1,424.5 | 0% |
| 50 | 1,525 | 16.97 | 138.6 | 66.5 | 309.1 | 417.9 | 1,762.8 | 1,904.5 | 0% |
| 100 | 2,947 | 32.91 | 389.1 | 186.8 | 1,047.4 | 1,453.7 | 3,481.9 | 3,637.8 | 0.07% |
| 150 | 3,764 | 41.84 | 940.8 | 719.8 | 1,993.6 | 2,739.0 | 4,085.8 | 6,964.9 | 0.03% |
| 200 | 3,756 | 41.88 | 1,980.8 | 1,633.5 | 3,970.4 | 5,039.4 | 6,832.5 | 9,963.1 | 0.03% |

Throughput essentially flattened between 150 and 200 users, while average latency more than doubled and P95 increased from 2.74 to 5.04 seconds. The 100-user request errors were two 403 submit responses; 150 and 200 each had one 403 submit response. The run did not show 5xx responses or timeouts in these stages.

The staged run recorded 14,441 requests including the drain period (13,118 during the seven load stages and 1,323 while draining).

At 100 users, the key endpoint results were:

| Request | Count | Avg ms | P95 ms | P99 ms | Outcome |
|---|---:|---:|---:|---:|---|
| Register | 88 | 722 | 1,600 | 2,070 | all 201 |
| Save section | 306 | 140 | 452 | 992 | all 200 |
| Submit | 46 | 220 | 826 | 949 | 44 x 200, 2 x 403 |
| Upload | 130 | 197 | 437 | 709 | all 201 |
| Home SSR page | 258 | 1,050 | 3,495 | 3,508 | all 200 |
| Courses page | 255 | 399 | 1,446 | 2,047 | all 200 |
| Apply page | 110 | 518 | 1,644 | 2,083 | all 200 |

The standalone 100-user run recorded 3,623 requests at 30.48 req/s, 690 ms average, 2,890 ms P95, and 7,835 ms P99, with zero request errors. It produced 123 synthetic accounts, 99 successful submissions, and 24 abandonments.

## Integrity and resource measurements

| Integrity check | 373-applicant staged run | 123-applicant 100-user run |
|---|---:|---:|
| Registrations | 373 | 123 |
| Documents in DB | 948 | 306 |
| Submitted responses | 301 | 99 |
| Submitted records in DB | 301 | 99 |
| Lost submissions / success not persisted | 0 | 0 |
| Submitted in DB but reported as failure | 0 | 0 |
| Applicants with multiple applications | 0 | 0 |
| Submitted applications without a number | 0 | 0 |
| Duplicate application numbers | 0 | 0 |
| Duplicate same-type documents | 0 | 0 |
| Missing stored document files | 0 | 0 |
| Duplicate submitted events | **26** | **7** |

The staged run had 72 abandoned applications. In the 30 recorded double-submit cases, 26 produced duplicate submitted events; the remaining submit responses included the 403s above. This did not create duplicate application rows or lose successful submissions, but it can duplicate applicant-visible history/audit activity.

The monitor's sampled maxima were: API CPU 332% (API average at 200 users was 97% of one core), API memory 516 MB, web CPU 89%, web memory 751 MB, MySQL memory 133 MB, and minimum free system memory 846 MB. MySQL CPU rounded to 0% at the monitor's sampling/rounding resolution. App connections ranged from 11 to 12, sampled busy connections peaked at 2, and the longest sampled query time was 0 seconds at the monitor's integer-second resolution. Across the monitor capture, row-lock deltas summed to 66 waits / 446 ms; the largest two-second sample was 3 waits / 82 ms. Health latency peaked at 86 ms and the stage-level health P95 at 200 users was 32 ms. These samples do not indicate connection exhaustion; the monitor did not provide a dedicated restart counter.

## Frontend measurements and unmeasured areas

A single local browser navigation recorded 620 ms to response end, 1,285 ms to DOMContentLoaded, and 1,294 ms to the load event, with 74 resources and about 8.66 MB transferred. This is a one-off development-server observation, not a controlled production frontend benchmark.

LCP, INP, and CLS were **not** measured. The saved load harness does not run a browser per simulated user. No network-throughput series, server-side timing header, SQL query-duration histogram, per-connection pool utilization, container metric, separate login burst, separate upload burst, submit-only burst, spike test, or endurance test was available. The maximum measured concurrency was 200; no higher level was tested.

## Findings and recommendations

| Severity | Finding | Evidence and impact | Recommendation |
|---|---|---|---|
| **CRITICAL** | Current source cannot initialize TypeORM in the admissions E2E setup. | `PortalAccessLog.event` is a string union without an explicit SQL column type; TypeORM reports unsupported `Object`. The E2E hook times out before executing tests. The same entity metadata is part of the application module, so this is a startup blocker to resolve before release. | Declare the column type explicitly (for example `varchar`) and rerun the E2E suite before using this working tree for a fresh load run. |
| **HIGH** | 100+ concurrent sessions exceed the provisional latency target and throughput plateaus. | P95 is 1.45 s at 100 users and 5.04 s at 200; throughput is about 42 req/s at both 150 and 200. API/web CPU rises while sampled DB activity remains low. | Treat 50 concurrent users as the provisional tested ceiling for a 1 s P95 target. Capture CPU profiles at 100 and 150 users before changing code; then scale the API/web tier based on the profile and repeat the same run. |
| **MEDIUM** | Double-submit was not idempotent in the saved pre-change runs. | 26 and 7 duplicate submitted events across the two runs; occasional 403 responses, though all successful submissions persisted. | The working tree now serializes submission with `SELECT ... FOR UPDATE`. Add an E2E assertion that two simultaneous submits create exactly one status event and both responses reflect the submitted application; then rerun the race test. This change is not yet verified under load. |
| **LOW** | Operational coverage is incomplete. | Browser Web Vitals, auth/upload/submit bursts, spike/endurance, and query-level timings were not measured. | Re-run on an isolated local/staging host with confirmed free ports and matching visitor-IP settings; collect browser Web Vitals and DB query/pool metrics. Do not infer bottlenecks in untested admin exports or search paths. |

No evidence justifies adding database indexes or changing the connection pool yet. The data points first to CPU saturation in the API/SSR tier, while the database health canary remained responsive. The API CPU profile is needed to distinguish SSR, password hashing, image processing, or another hot path before implementing performance optimizations.

## Artifacts

- [`baseline-steps.json`](./results/baseline-steps.json) and [`baseline-steps.log`](./results/baseline-steps.log)
- [`monitor-baseline-steps.csv`](./results/monitor-baseline-steps.csv)
- [`profile-100.json`](./results/profile-100.json) and [`profile-100.log`](./results/profile-100.log)
- [`integrity.mjs`](./integrity.mjs), [`run.mjs`](./run.mjs), and [`README.md`](./README.md)
