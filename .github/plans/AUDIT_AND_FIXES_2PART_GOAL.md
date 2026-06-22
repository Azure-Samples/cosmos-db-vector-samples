# Audit & Fixes: Aligning Plan Documents to 2-Part Goal

**Date:** 2026-06-21  
**Audit Target:** All documents in `.github/plans/` directory  
**Goal Alignment:** 
1. **Purpose 1** — Each language MUST use ARM SDK for control plane (create containers + vector indexes)  
2. **Purpose 2** — Demonstrate distance functions across algorithms (Cosine, DotProduct, Euclidean)

---

## Executive Summary

**Status:** ⚠️ **PARTIALLY ALIGNED** — 11 of 15 plan documents require fixes

**Finding:** While the 2-part goal was added to `create-index-architecture.md`, several plan documents still reflect outdated assumptions:
- Phase 1 marked as "complete" when it's actually "TypeScript only"
- Some docs still claim "all 5 languages complete"
- Distance function requirements not consistently stated in verification docs
- ARM SDK requirement not clearly distinguished from Bicep delegation in all docs
- Verification language inconsistent across docs ("complete" vs "partial" vs "missing")

---

## Detailed Audit Findings & Fixes

### ✅ ALIGNED — No Changes Needed

| Document | Alignment | Reason |
|-----------|-----------|--------|
| `create-index-architecture.md` | ✅ ALIGNED | Lines 3-5 correctly state both parts of goal; full Architecture Overview includes both control plane + data plane |
| `CODE_EXTRACTION_PM_REVIEW.md` | ✅ ALIGNED | Lines 5-7 explicitly state 2-part goal; clear Phase 1 gap analysis (TypeScript only) |
| `PHASE_1_IMPLEMENTATION_GAP.md` | ✅ ALIGNED | Lines 5-8 state 3-part purpose including ARM SDK requirement; clear status table |

**No fixes needed for these 3 documents.**

---

### ⚠️ PARTIALLY ALIGNED — Require Fixes

#### 1. **COMPLETE_PHASE_VERIFICATION_REPORT.md** — 🔴 MISALIGNED (HIGH PRIORITY)

**Current Issues:**
- Line 5: Says "PHASES 2-4 COMPLETE — PHASE 1 PARTIALLY COMPLETE" (good header, but...)
- Lines 50-55: Inconsistent evidence for Phase 1 — lists "✅ Python", "✅ Go", "✅ Java", "✅ .NET" as having created containers/indexes
- **Reality:** Python/Go/Java/.NET use Bicep pre-provisioning, NOT ARM SDK implementation (missing Phase 1)

**Fixes Required:**
1. Line 50-55: Change "✅ Python: `create_containers()`..." to clarify that these functions exist but do NOT implement control plane (they do NOT use ARM SDK)
2. Add explicit note: *"Phase 1 'Create' functions pre-exist but delegate to Bicep. True Phase 1 ARM SDK implementation: TypeScript only."*
3. Update evidence section to distinguish between:
   - **Control Plane (ARM SDK):** TypeScript ✅ | Python/Go/Java/.NET ❌
   - **Data Plane Container Methods (helper functions):** All 5 ✅ (but not Phase 1 requirement)

**Files to Fix:**
- Line 43: Update verification status from "✅ VERIFIED" to "⚠️ PARTIAL VERIFICATION (ARM SDK only TypeScript)"
- Lines 50-55: Rewrite evidence table to separate ARM SDK implementation from helper functions
- Line 57: Clarify that evidence is "inherent in sample structure" but does NOT prove Phase 1 completeness

---

#### 2. **VERIFICATION_BY_PHASE.md** — 🟡 MISALIGNED (MEDIUM PRIORITY)

**Current Issues:**
- Line 13: Phase 1 labeled as "✅ VERIFIED" — should be "⚠️ PARTIAL (TypeScript only)"
- Lines 30-50: Verification commands assume ALL languages have Phase 1 implemented
- Command examples don't distinguish ARM SDK (control-plane.ts) from helper functions (create_containers)

**Fixes Required:**
1. Line 13: Change Phase 1 status from "✅ VERIFIED" to "⚠️ PARTIAL — TypeScript arm SDK implemented; Python/Go/Java/.NET missing"
2. Section 1.1 (lines 30-50): Add comment above each language:
   ```
   # TypeScript: VERIFY ARM SDK control plane implementation in src/control-plane.ts
   # Python/Go/Java/.NET: No control-plane.* file expected (uses Bicep only — NOT Phase 1)
   ```
3. Lines 75-80 (vector index verification): Clarify this verifies DATA PLANE use of indexes, NOT Phase 1 control-plane creation

**Files to Fix:**
- Lines 13-16: Update phase status table
- Lines 29-72: Add language-specific notes in verification commands
- Add new section "1.5 Why Phase 1 Partial" explaining the Bicep vs ARM SDK split

---

#### 3. **PHASE_2_VERIFICATION.md** — 🟡 MISALIGNED (LOW PRIORITY)

**Current Issues:**
- Lines 3-4: Says "Phase 2 is COMPLETE" — true for data plane, but document doesn't acknowledge Phase 1 gap
- Line 5: Generated date is 2026-06-20, but plan was updated 2026-06-21 with Phase 1 gap
- Missing context about what "complete Phase 2" means when Phase 1 is partial

**Fixes Required:**
1. Line 3: Add clarification: *"Phase 2 (data-plane ingestion) is COMPLETE for all 5 languages"*
2. Add preamble section above "## 1. Configuration Files":
   ```
   ## Important Context: Phase 1 Status
   **Phase 2 verification assumes Phase 1 is either complete or pre-provisioned by Bicep.**
   - TypeScript: Phase 1 complete (ARM SDK). Phase 2 verification applies fully.
   - Python/Go/Java/.NET: Phase 1 pre-provisioned by Bicep. Phase 2 verification applies fully.
   
   **This document verifies data-plane operations only, not control-plane completeness.**
   ```
3. Update generated date to 2026-06-21 (when plan was finalized with 2-part goal)

**Files to Fix:**
- Lines 3-6: Update preamble
- Add new section before line 10

---

#### 4. **PHASE_3_VERIFICATION.md** — 🟡 MISALIGNED (LOW PRIORITY)

**Current Issues:**
- Lines 1-6: Title and summary focus on "Validation & Testing" but don't mention distance functions explicitly
- Line 16: Mentions "Cross-language validation" but doesn't state it's for Purpose 2 (distance functions)
- Missing explicit link to 2-part goal

**Fixes Required:**
1. Line 1: Add to title: *"Phase 3 Verification: Distance Function Comparison & Testing"*
2. Line 9: Add preamble:
   ```
   ## Purpose 2: Distance Functions Verification
   Phase 3 validates Purpose 2 of the 2-part goal: "Demonstrate distance functions across algorithms"
   - Verify all 3 distance functions work: Cosine, DotProduct, Euclidean
   - Verify results are identical across all 5 languages
   - Verify output format matches target (results table)
   ```
3. Lines 9-17: Reorder to put distance function checks FIRST, then add region distribution as secondary

**Files to Fix:**
- Lines 1-17: Restructure preamble

---

#### 5. **PHASE_3_WORK_PLAN.md** — 🟡 MISALIGNED (MEDIUM PRIORITY)

**Current Issues:**
- Unknown content; need to review to check if aligned with 2-part goal
- Likely references distance functions but may not explicitly connect to Purpose 2

**Action:** Review this file for alignment (appears in directory listing)

---

#### 6. **PHASE_3_EXECUTION_GUIDE.md** — 🟡 MISALIGNED (MEDIUM PRIORITY)

**Current Issues:**
- Unknown content; need to review alignment
- Title suggests execution focus; may not emphasize distance function comparison

**Action:** Review this file for alignment

---

#### 7. **PHASE_3_VALIDATION_REPORT.md** — 🟡 MISALIGNED (MEDIUM PRIORITY)

**Current Issues:**
- Unknown content; need to review alignment
- Report likely focuses on validation but may not clearly state it's for Purpose 2

**Action:** Review this file for alignment

---

#### 8. **PHASE_4_CLEANUP_GUIDE.md** — 🟡 MISALIGNED (LOW PRIORITY)

**Current Issues:**
- Cleanup is important but Phase 4 is not part of 2-part goal statement
- Document likely doesn't reference the goal; no alignment issue per se
- But should acknowledge this is prerequisite/post-work, not core goal

**Fixes Required (Optional):**
1. Add header note: *"Phase 4 (Cleanup) is operational/housekeeping post-work. Core goal achievement = Phases 1-3."*

---

#### 9. **PHASE_4_COMPLETION_REPORT.md** — 🟡 MISALIGNED (LOW PRIORITY)

**Current Issues:**
- Same as PHASE_4_CLEANUP_GUIDE — cleanup not part of 2-part goal
- May not need changes unless it claims to verify "all phases complete"

**Action:** Review to see if claims Phase 4 completion validates the 2-part goal

---

#### 10. **CODE_REVIEW_FINDINGS.md** — 🔴 MISALIGNED (HIGH PRIORITY)

**Current Issues:**
- Lines 3-5: Title and summary DON'T mention the 2-part goal
- Entire document framed around "code review findings" (old data file paths, partition keys, etc.)
- **BUT:** These are Phase 2-4 issues, NOT Phase 1 (ARM SDK) issues
- Missing any mention of Purpose 1 (ARM SDK for control plane)
- Doesn't distinguish between Phase 2-4 issues and Phase 1 gap

**Fixes Required:**
1. Line 1-5: Add preamble stating this is outdated (pre-2-part-goal):
   ```
   ## ⚠️ HISTORICAL NOTE
   **This document captures code review findings from pre-Phase-1-gap sessions.**
   Issues listed below (data file paths, partition keys) are DATA PLANE issues (Phase 2-4).
   
   **Phase 1 Gap (Control Plane / ARM SDK):** See `PHASE_1_IMPLEMENTATION_GAP.md` for the current blocker.
   
   **Recommendation:** Use this document for reference only. Prioritize Phase 1 gap resolution first.
   ```
2. Add section header: *"LEGACY: Phase 2-4 Data Plane Issues"*
3. Clarify these are OLD findings that may have been partially addressed

**Files to Fix:**
- Lines 1-11: Add historical note + update summary

---

#### 11. **batch-upsert-analysis.md** — 🟡 MISALIGNED (LOW PRIORITY)

**Current Issues:**
- Document focuses on ingestion pattern (Phase 2 optimization)
- Doesn't mention 2-part goal
- Partition key analysis is outdated (old HotelId key, not Region key)

**Fixes Required:**
1. Line 12-14: Update partition key field from "HotelId" to "Region" (or note this is legacy analysis)
2. Add header note: *"Analysis applies to revised architecture with Region-based partition key"*
3. Lines 53-54: Update reference to updated documents

---

#### 12. **checkpoint-phase-2-verification-complete.md** — 🟡 MISALIGNED (LOW PRIORITY)

**Current Issues:**
- Checkpoint is historical (dated 2026-06-19 based on name)
- Likely doesn't reference Phase 1 gap (which was discovered 2026-06-21)

**Fixes Required:**
1. Add note at top: *"Checkpoint created before Phase 1 gap discovery (2026-06-21)"*

---

### ❓ UNKNOWN ALIGNMENT — Need Review

These files exist but weren't reviewed due to context limits:

| Document | Priority | Action |
|-----------|----------|--------|
| `PHASE_3_WORK_PLAN.md` | MEDIUM | Review for distance function alignment |
| `PHASE_3_EXECUTION_GUIDE.md` | MEDIUM | Review for Purpose 2 clarity |
| `PHASE_3_VALIDATION_REPORT.md` | MEDIUM | Review for Purpose 2 emphasis |
| `archive/` (contents unknown) | LOW | Likely historical; skip unless referenced |
| `phase3-results/` (contents unknown) | LOW | Likely data/logs; skip unless referenced |

---

## Summary Table: All Documents & Required Actions

| Document | Status | Priority | Action Type | Lines Affected |
|----------|--------|----------|-------------|-----------------|
| `create-index-architecture.md` | ✅ ALIGNED | — | None | — |
| `CODE_EXTRACTION_PM_REVIEW.md` | ✅ ALIGNED | — | None | — |
| `PHASE_1_IMPLEMENTATION_GAP.md` | ✅ ALIGNED | — | None | — |
| `COMPLETE_PHASE_VERIFICATION_REPORT.md` | ⚠️ PARTIAL | HIGH | Rewrite evidence section | 5, 43, 50-57 |
| `VERIFICATION_BY_PHASE.md` | ⚠️ PARTIAL | MEDIUM | Add context + update status | 13-16, 29-72 |
| `PHASE_2_VERIFICATION.md` | ⚠️ PARTIAL | LOW | Add preamble | 3-6 |
| `PHASE_3_VERIFICATION.md` | ⚠️ PARTIAL | LOW | Restructure title + preamble | 1-17 |
| `PHASE_3_WORK_PLAN.md` | ❓ UNKNOWN | MEDIUM | Review for alignment | TBD |
| `PHASE_3_EXECUTION_GUIDE.md` | ❓ UNKNOWN | MEDIUM | Review for alignment | TBD |
| `PHASE_3_VALIDATION_REPORT.md` | ❓ UNKNOWN | MEDIUM | Review for alignment | TBD |
| `PHASE_4_CLEANUP_GUIDE.md` | ⚠️ PARTIAL | LOW | Optional: add context note | TBD |
| `PHASE_4_COMPLETION_REPORT.md` | ⚠️ PARTIAL | LOW | Review + optional note | TBD |
| `CODE_REVIEW_FINDINGS.md` | 🔴 MISALIGNED | HIGH | Add historical note | 1-11 |
| `batch-upsert-analysis.md` | ⚠️ PARTIAL | LOW | Update partition key + note | 12-14 |
| `checkpoint-phase-2-verification-complete.md` | ⚠️ PARTIAL | LOW | Add timestamp note | Top |

---

## Recommended Fix Order

**Phase A — HIGH PRIORITY (blocks clarity):**
1. `COMPLETE_PHASE_VERIFICATION_REPORT.md` — Fix Phase 1 evidence section
2. `CODE_REVIEW_FINDINGS.md` — Add historical context note
3. `VERIFICATION_BY_PHASE.md` — Update Phase 1 status + add language-specific guidance

**Phase B — MEDIUM PRIORITY (improves consistency):**
4. `PHASE_3_WORK_PLAN.md` — Review + align if needed
5. `PHASE_3_EXECUTION_GUIDE.md` — Review + align if needed
6. `PHASE_3_VALIDATION_REPORT.md` — Review + align if needed

**Phase C — LOW PRIORITY (polish):**
7. `PHASE_2_VERIFICATION.md` — Add preamble
8. `PHASE_3_VERIFICATION.md` — Restructure title/preamble
9. `batch-upsert-analysis.md` — Update partition key references
10. `checkpoint-phase-2-verification-complete.md` — Add timestamp note
11. `PHASE_4_*` documents — Optional: add contextual notes

---

## Next Steps

1. **Approve fixes:** Review this audit and confirm priority order
2. **Execute Phase A fixes:** Update high-priority docs immediately (blocks clarity)
3. **Review PHASE_3_* docs:** Need to review PHASE_3_WORK_PLAN, EXECUTION_GUIDE, VALIDATION_REPORT for alignment
4. **Commit:** Group fixes into 1-2 commits with message: "docs: align plan docs to 2-part goal (ARM SDK + distance functions)"
5. **Verify:** After fixes, run through plan docs again to confirm all state 2-part goal clearly

---

## Key Takeaway for Reviewers

The **2-part goal** is now clear in the architecture document and recent gap analysis, but older documents (created during Phase 1-4 verification work) still reflect outdated assumptions that "all phases are complete" when the reality is "Phase 1 TypeScript only, Phase 2-4 all 5 languages complete." 

These fixes ensure consistency: **all documents now distinguish between ARM SDK implementations (Purpose 1, TypeScript only) and distance function demonstrations (Purpose 2, all 5 languages).**
