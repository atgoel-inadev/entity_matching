. Overview & Purpose
1.1 The real problem we’re solving
Across our stack, the same real‑world entity shows up in different systems and slightly different forms:

Companies / accounts – “IBM”, “International Business Machines”, “I.B.M. Corp”

Buyers / customers – “Jon Smith, john.smith@acme.com” vs “John Smith, (555) 010‑1001”

Addresses – “123 Main St, NYC” vs “123 Main Street, New York”

Suppliers – “ACME Corp, TIN: 36‑1234567” vs “Acme Corporation, 36‑1234567”

In our environment:

Salesforce is the system of record (SoR) for most core entities (buyers, suppliers, accounts, etc.) and is maintained by Client Management and other business teams.

Gen3 (PostgreSQL) is our transactional system, where these entities are used in flows (e.g., new transactions).

Snowflake is our data warehouse, where we mirror data from Salesforce / Gen3 for analytics and compute.

Today, each application that needs to answer “Is this record an existing buyer/supplier/account, or a new one?” implements its own ad‑hoc matching logic. This causes duplicates, inconsistent truth, compliance blind spots, and manual clean‑up.

1.2 What ResolveIQ is (in one sentence)
ResolveIQ is a central, configuration‑driven “who is this really?” service that any application (starting with Gen3) can call to decide whether a record refers to an existing Salesforce entity or represents a new candidate entity.

Matches records in real time (exact, fuzzy, semantic) against a Snowflake mirror of Salesforce (and other SoRs).

Returns a canonical entity id + match score + explanation.

Flags “new entity candidates” that should go through Salesforce / Client Management workflows.

1.3 Core value proposition
Single shared resolution brain across buyers, suppliers, accounts, companies, people, addresses, products.

Config‑driven and reusable: new use case = profile + fields, not schema/deployment change.

Six match strategies per field: EXACT, FUZZY, SEMANTIC (AI), PHONETIC, NUMERIC, NONE.

Explained decisions: per‑field scores, composite score, and match types (EXACT_ALL, SEMANTIC, NEW_ENTITY, etc.).

Real‑time friendly: sub‑second targets for inline Gen3 flows; cache hits in single‑digit milliseconds.

Aligned with SoR: for Salesforce entities, ResolveIQ matches against a Snowflake mirror and does not replace Salesforce as SoR.

4. Fit for Salesforce → Gen3 → Snowflake
4.1 System of Record alignment
For SoR‑backed profiles, ResolveIQ mirrors Salesforce records in Snowflake and never replaces Salesforce as SoR. New authoritative entities are created in Salesforce; ResolveIQ may surface “new candidate” outcomes but does not bypass SoR governance.

4.2 High‑level buyer flow (example)
Salesforce → Snowflake: buyers mirror kept current via pipeline.

ResolveIQ ingest: builds profile_entities and embeddings for buyer-match from the Snowflake mirror.

Gen3 transaction calls POST /profiles/buyer-match/resolve with available buyer attributes.

ResolveIQ returns canonical id + score + match_type (authoritative if it maps to a Salesforce record).

If NEW_ENTITY, Gen3 triggers a Salesforce “New Buyer” workflow; ResolveIQ’s temporary ids are not treated as authoritative.

15. End‑to‑End Buyer Example (Gen3 Transaction Flow)
15.1 Buyer profile configuration (buyer-match)
Metadata: slug=buyer-match; source_system=Salesforce; external_id_field=sf_buyer_id; allow_authoritative_create=false.

Fields: buyer_name_semantic (SEMANTIC, 4.0), buyer_name_fuzzy (FUZZY, 2.0), email (EXACT, 4.0), phone (NUMERIC, 2.0), tax_id (EXACT, 3.0), country (EXACT, 1.0), city (FUZZY, 1.0).

15.2 Upstream data and entity ingest
Salesforce → Snowflake buyers mirror (e.g., buyers_raw with sf_buyer_id, buyer_name, email, phone, tax_id, city, country, last_modified_at).

ResolveIQ ingest builds/refreshes profile_entities and buyer_name_semantic embeddings from buyers_raw (full nightly + incremental by last_modified_at).

15.3 Transaction‑time: existing buyer (happy path)
Gen3 submits a resolve request (POST /profiles/buyer-match/resolve) with whatever buyer attributes are available at transaction time (e.g., name, email, phone, tax_id, city, country), and includes/receives a correlation_id for traceability.

ResolveIQ evaluates each configured field using its configured strategy (EXACT/FUZZY/SEMANTIC/NUMERIC, etc.) and produces per-field scores plus a weighted composite score.

ResolveIQ classifies the outcome into a match_type (e.g., EXACT/EXACT_FASTPATH/HYBRID_HIGH/COMPOSITE) based on the composite score and any strong signals (e.g., exact email/tax_id), so Gen3 can make a policy-based decision.

If the score/match_type meet Gen3’s acceptance thresholds, Gen3 treats the result as an authoritative match and attaches the returned canonical entity reference (Salesforce external_id, e.g., sf_buyer_id) to the transaction.

Missing or partial inputs are handled naturally: only provided fields contribute to scoring, so Gen3 can still resolve when some buyer attributes are not present at the time of the call.

The resolve decision is recorded for reproducibility and audit (request payload, field_scores, composite score, match_type, chosen entity/external_id, snapshot metadata), typically via ResolveIQ’s profile_match_log and Gen3 transaction references.

Where applicable, caching (Redis/L2) accelerates repeated resolves for the same buyer attributes, reducing transaction-time latency while preserving the logged audit trail.

ResolveIQ computes field_scores, composite score, classifies match (e.g., HYBRID_HIGH), and returns entity_id mapped to a Salesforce external_id. Gen3 auto‑attaches the buyer when score and match_type meet thresholds.

15.4 Transaction‑time: no good match (new buyer candidate)
ResolveIQ returns match_type = NEW_ENTITY (no adequate match; non-authoritative) for the buyer-match profile.

Gen3 creates a New Entity Request linked to the transaction and the ResolveIQ decision (including correlation_id, match_score, and any field_scores/explanations).

Gen3 evaluates a configurable routing policy (by profile/entity type and optional attributes like country/product line/risk tier) to choose the owning business team and queue (e.g., Client Management for buyers; Supplier Ops for suppliers).

Gen3 automatically opens a case/ticket in the configured workflow system (Salesforce Case or Jira) with transaction id, New Entity Request id, and candidate details, and sends automated notification to the assigned team.

The business owner reviews, enriches, de-duplicates in Salesforce, and completes any compliance/KYC checks; if valid, they create the new authoritative Salesforce record (SoR).

The new Salesforce id (e.g., sf_buyer_id) is recorded on the case/ticket and linked back to the Gen3 New Entity Request for traceability.

After Salesforce → Snowflake sync and ResolveIQ ingest, Gen3 updates the parked transaction with the authoritative SoR id and automatically requeues/unblocks processing (via event/webhook or scheduled polling).

All steps are auditable: ResolveIQ logs NEW_ENTITY in profile_match_log; Gen3/workflow artifacts store request/case ids and final Salesforce id for end-to-end traceability.

15.5 Error handling and fallback
If ResolveIQ is unavailable/slow: fall back to exact Postgres checks (e.g., id/email), log for later enrichment.

If borderline score: allow with flag or route to review, based on flow policy.

16. Auditing, Logging & Traceability
16.1 Goals
Who/what called ResolveIQ; exactly what input was resolved; what ResolveIQ did (field‑level scores, composite, match type, thresholds); what it returned; when; ability to replay/re‑score.

16.2 Core audit tables and logs
Snowflake table profile_match_log is the system‑of‑record for resolution events, complemented by structured application logs for observability.

profile_match_log (conceptual columns): log_id, timestamp_utc, profile_slug, source_system, correlation_id, request_payload (VARIANT), match_entity_id, external_system, external_id, match_score, match_type, field_scores (VARIANT), is_new_entity, is_authoritative, model_version, profile_snapshot_ts, entities_snapshot_ts, error_code, error_message.

16.3 Application‑level logging
For each request: timestamp_utc, correlation_id, profile_slug, endpoint, source_system, latency_ms, result_status, match_type/match_score summary, error_code/message. These support SRE dashboards and troubleshooting and complement profile_match_log.

16.4 Buyer resolution audit example (what’s logged)
Existing buyer: request payload, selected entity_id + Salesforce external_id, match_score/type, field_scores, model_version, profile_snapshot_ts, entities_snapshot_ts.

NEW_ENTITY: request payload, correlation_id, is_new_entity=true, is_authoritative=false, linkage to Salesforce “New Buyer Request” where available.

16.5 Governance for Salesforce‑backed profiles
Every authoritative match traces to a Salesforce record (external_id), the SoR mirror snapshot used (entities_snapshot_ts), and the config/model in effect (profile_snapshot_ts, model_version). New entity candidates are joinable to Salesforce workflow artifacts for end‑to‑end review.

16.6 Reproducibility and re‑scoring
By logging request_payload, profile_slug, model_version, profile_snapshot_ts, and entities_snapshot_ts, decisions can be replayed against new configs/models/snapshots for regression testing and investigations.

16.7 Access control and retention
Restrict profile_match_log via Snowflake RBAC (e.g., dedicated read‑only/admin roles); limit PII in app logs; prefer correlation ids to join with Snowflake for deep dives.

Define data retention aligned with compliance and internal governance.