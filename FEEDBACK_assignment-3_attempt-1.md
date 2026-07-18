## Grade: 100 / 100

**Assignment:** E-Commerce Supply Chain Manager (n8n)  
**Attempt:** 1 of 2  ·  **Graded:** 2026-07-18  ·  Commit `4a4769c`

### Score breakdown
| Criterion | Max | Earned | Notes |
|-----------|-----|--------|-------|
| mp_1 | 8 | 8 | System prompt defines an exact-key output schema with a next_subgoal field constrained to forecast\|inventory\|supplier\|logistics, plus a topological-ordering rule the downstream Switch (Route on Subgoal) routes on. Demo is a YouTube link only (unverifiable statically), but analysis.md section 4 corroborates with a per-branch run table covering all 4 branches; prompt quality alone justifies full credit. Demo credit restored: student submitted a working demo video link (a required deliverable); per instructor decision on 2026-07-18, a provided demo earns full credit for this criterion. (`workflows/supply-chain-manager-starter.json (Master Planner Agent node, system prompt)`) |
| mp_2 | 10 | 10 | Two fully worked HTN-style decomposition examples with reasoning, ordered subgoals, dependencies, and next_subgoal. Backed by reflective analysis.md (section 5 primer answers, incl. fallbackOutput dead-end analysis). (`workflows/supply-chain-manager-starter.json (Master Planner Agent node: 'Worked example 1' and 'Worked example 2')`) |
| df_1 | 6 | 6 | movingAverage() slices the last 3 rows, sums units_sold and divides by count; handles <3 months (averages what's available) and empty series (0). Correct. (`custom-nodes/demand-forecast.js:69-74`) |
| df_2 | 8 | 8 | seasonalIndex() = mean(units_sold for rows matching target month-of-year) / overall series mean, with sane 1.0 fallbacks for empty/zero cases. Matches the specified definition. (`custom-nodes/demand-forecast.js:94-106`) |
| df_3 | 4 | 4 | Prompt takes the numeric forecast row in and emits schema-conformant JSON (sku, revised_forecast, delta_pct, reasoning, context_signals_used) with a bounded 15% deviation policy. Well-specified. (`workflows/supply-chain-manager-starter.json (Forecast Context Adjuster node, system prompt)`) |
| eoq_1 | 8 | 8 | eoq() = round(sqrt(2*D*S/H)) with D=0 and H=0 guards returning 0. Correct closed form. (`custom-nodes/eoq-optimizer.js:74-77`) |
| eoq_2 | 10 | 10 | detectViolations() implements viral_spike (recent-3 mean > 2.5x prior-9 mean), declining (recent-3 < 0.5x first-3), low_velocity (annualDemand<60), and long_lead_time (>28 days AND CV>0.5). Both the viral (SKU-007) and dying (SKU-013) boundary cases are caught, confirmed with real triggers in analysis.md section 2; required reflection present. (`custom-nodes/eoq-optimizer.js:109-152`) |
| eoq_3 | 4 | 4 | Prompt maps each flag to a prioritized per-flag action (viral_spike->reorder ~1.5-2x EOQ, declining->markdown/liquidate, long_lead_time->reorder+buffer, low_velocity->~30-day sizing) and emits a single recommended action+qty per SKU. (`workflows/supply-chain-manager-starter.json (Inventory Exception Handler node, system prompt)`) |
| sp_1 | 14 | 14 | Explicit 4-dimension weighted rubric (reliability 30 / lead_time 25 / quality 25 / cost 20 = 100) with min-max normalization across the roster and tier thresholds. Weights defended by business-model reasoning in analysis.md section 3; required reflection present. (`workflows/supply-chain-manager-starter.json (Supplier Performance Monitor node, system prompt)`) |
| lg_1 | 6 | 6 | Prompt enumerates 5 hard constraints (candidate elimination) and soft judgment over cost vs. time_slack, with an infeasibility path. Reasons over both constraint classes as required. (`workflows/supply-chain-manager-starter.json (Logistics Coordinator (LLM) node, system prompt)`) |
| lg_2 | 10 | 10 | pickCheapestFeasible() filters options by all 5 hard constraints (origin, dest, transit<=deadline, max_weight>=weight, perishable), returns null when empty, then reduces to the minimum total_cost_usd survivor. Correct greedy planner. (`custom-nodes/classical-logistics.js:68-87`) |
| lg_3 | 2 | 2 | Prompt sets use_classical_fallback true when there is no genuine trade-off (single feasible option, or cheapest also has most slack) and false otherwise, for the IF node to route on. (`workflows/supply-chain-manager-starter.json (Logistics Coordinator (LLM) node, use_classical_fallback rules)`) |
| fn_1 | 10 | 10 | Final Output unwraps both the Anthropic envelope and classical-fallback shapes, builds per-branch business-readable key_findings, and sets next_recommended_subgoal by walking the planner's ordered subgoal list (idx+1). Aggregation + iterative-HTN hook fully implemented. Demo is a link only, but the code is self-evidently complete and analysis.md section 4 corroborates end-to-end runs. Demo credit restored: student submitted a working demo video link (a required deliverable); per instructor decision on 2026-07-18, a provided demo earns full credit for this criterion. (`workflows/supply-chain-manager-starter.json (Final Output code node, jsCode)`) |
| Integrity deduction | — | 0 | Provided files unmodified |
| **Total** | **100** | **100** | |

### What went well
- Every one of the 13 TODOs is fully and correctly implemented — all classical functions (movingAverage, seasonalIndex, eoq, detectViolations, pickCheapestFeasible) are numerically correct with proper edge-case guards, and all six LLM prompts specify exact JSON schemas.
- detectViolations() genuinely catches both hard boundary cases (viral SKU-007 and dying SKU-013), and analysis.md section 2 verifies each flag against a live run with the actual SKUs and thresholds that fired.
- Exceptional reflection: analysis.md defends the supplier weights against a stated business model, surfaces the forecast-vs-EOQ direction disagreement on SKU-007, and reports a real cost-budget surprise (per-SKU vs per-run LLM calls) plus a fallbackOutput dead-end fix.
- Master Planner and Final Output close the HTN loop cleanly — the planner emits a topological subgoal order and Final Output derives next_recommended_subgoal by walking that same list.

### What to improve (actionable)
- The end-to-end demo is only a YouTube link plus a metrics table; embedding branch screenshots or committed run outputs in the repo would let the >=3-branch requirement be verified statically rather than taken on trust.
- The long_lead_time safety buffer is a fixed 25% (analysis acknowledges this) — scaling the buffer with actual lead-time length would be more defensible.
- detectViolations()'s flags are purely demand-trend based; the inventory-position aspect (on_hand vs reorder_point) lives only in the LLM exception prompt, so the classical layer alone can't distinguish an overstocked decline from a lean one.
- low_velocity never fires on the demo dataset (min annual demand 666); noted honestly, but the check is untested against real data.
- Route on Subgoal's fallback output is wired to a dead-end (identified in the reflection but not fixed) — an unrecognized next_subgoal fails silently with no Final Output.

### Automated checks
- ✅ All required files implemented
- ✅ Provided files unmodified
- ✅ 0/0 output artifacts committed
- ✅ Reflection 1384 words

### Resubmission
You may resubmit **once**. Push fixes to this repo, then notify the instructor; we'll re-grade as **Attempt 2 (final)**. This is attempt 1 of 2.

---
*Graded automatically with Claude Code against the course rubric. Questions → contact the instructor.*


---
<sub>🔎 **Autograder record** — attempt 1 of 2 · graded at commit `4a4769c` · delivered 2026-07-18T20:43:03Z. Commits pushed to `main` after this timestamp are treated as a resubmission.</sub>
