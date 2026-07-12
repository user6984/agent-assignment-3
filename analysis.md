# Analysis — Assignment 3: Intelligent E-commerce Supply Chain Manager

## 1. Algorithm comparison: SKU-007 (Wool Gloves) vs. SKU-012 (Bluetooth Buds)

**SKU-007, the anomaly case.** The classical layer computes `moving_avg = 376.7`, `seasonal_index = 0.94` for target month 2026-01, giving `forecast_units = 354` with `statistical_confidence = 0.25`. The Forecast Context Adjuster revised this **down** to 301 units (-14.9%), reasoning that low confidence plus "no obvious acceleration catalyst" suggested the moving average was overstating a fading trend.

That reasoning is wrong, and the rest of the pipeline proves it. The Inventory EOQ Planner, which sees the full 12-month sales series rather than one summarized row, flags SKU-007 with `viral_spike` (recent 3-month mean > 2.5x the prior 9-month mean) and `long_lead_time`, computes `annual_demand = 1673` against an `eoq_units` of 431, and — with `on_hand` at only 18 against a `reorder_point` of 80 — recommends an emergency reorder of 862 units (2x EOQ). That matches the business scenario's own description of SKU-007 as the SKU "going viral." The forecast LLM guessed the *direction* of the anomaly wrong because `Forecast Context Adjuster` only receives the aggregated row (`moving_avg`, `seasonal_index`, `statistical_confidence`) — it has no access to the recent-vs-prior split that `detectViolations()` computes directly from the raw series. Low confidence alone is ambiguous (it says "something changed," not which way); the classical detector, working from more granular data, resolves the ambiguity correctly. I'd trust the EOQ branch's read over the forecast branch's here, and would defend that with an explicit rule: when the two branches disagree on direction for the same SKU, treat the classical branch as authoritative if it has access to strictly more raw data than the LLM step did.

**SKU-012, the well-behaved case.** `moving_avg = 83`, `seasonal_index = 0.99`, `statistical_confidence = 0.97`. The Forecast Context Adjuster left it at 82 units (0% revision), correctly recognizing there's no signal in the row that contradicts the classical number. No EOQ flags fire either (`annual_demand = 986`, comfortably reorderable). This is the boring, correct case, and it's exactly what should happen most of the time — the LLM step is a safety net for the minority of SKUs where the classical assumptions strain, not a second-guessing layer applied uniformly.

## 2. EOQ assumption analysis

Flags implemented, thresholds, and real triggers from a live run:

- **`viral_spike`** (recent 3-month mean > 2.5x prior 9-month mean): fires on SKU-007 only. Exception handler recommends a 862-unit reorder (2x EOQ's 431) given `on_hand` (18) is already below `reorder_point` (80). I agree — EOQ's constant-demand assumption is visibly broken here and a same-multiplier-as-EOQ order would under-cover an accelerating trend.
- **`declining`** (recent 3-month mean < 0.5x first 3-month mean): fires on SKU-013 only. `on_hand` (540) is 6.75x `reorder_point` (80). Exception handler recommends liquidation over a markdown, crossing the 5x liquidation threshold I set in the prompt. I agree — EOQ would otherwise recommend reordering ~397 more units (its `eoq_units`) into a position that's already badly overstocked for a shrinking product.
- **`long_lead_time`** (`lead_time_days > 28` AND demand is volatile, coefficient of variation > 0.5): fires on SKU-005, SKU-006, and SKU-009 (alongside SKU-007). Exception handler adds a 25% safety buffer over EOQ for each. I agree with the buffer directionally, though 25% is a round number I chose rather than derived — a more defensible version would scale the buffer with the lead time itself (a 35-day lead time deserves a bigger cushion than a 29-day one), which I didn't implement.
- **`low_velocity`** (`annual_demand < 60`): implemented but never fires in this dataset — the lowest annual demand across all 15 SKUs is 666 units/year (SKU-005). I kept the check anyway because a real long-tail catalog would hit it; the demo data just doesn't have a slow-mover to exercise it.
- **Perishability**: not implemented, per the assignment's own note that none of the demo SKUs are perishable. A real version would need it — EOQ's "no stockout cost cliff" assumption breaks hard for anything with a shelf life, independent of demand volume or trend.

## 3. Supplier rubric defense

Weights: reliability 30 / lead_time 25 / quality 25 / cost 20 (sums to 100). Business-model assumption: Coastal Goods is a DTC e-commerce seller carrying at least one SKU with viral-demand risk (SKU-007), so a stockout is the costliest failure mode — I weighted reliability and lead time (55 combined) above quality (25) and cost (20). A hospital supply chain would likely weight quality far higher and tolerate more cost for compliance reasons; a pure commodity reseller might weight cost highest. Scoring method: min-max normalize each dimension across the 6-supplier roster (best = 100, worst = 0), then weighted sum.

From a live run: **SUP-006** (Bavaria Paper Mills) ranked highest at 85.74, tier "preferred" — best-in-roster reliability (0.98 on-time) and quality (0.005 defect rate), moderate lead time. **SUP-002** (Pacific Rim Trading) and **SUP-003** (Andes Outfitters) tied for lowest, 35.15 and 36.76, both "deprioritize" — SUP-002 on worst reliability and quality, SUP-003 on the roster's longest lead time (35 days). Both rankings match my intuition looking at the raw KPI table: SUP-006 has no real weakness, and both bottom suppliers have exactly one dimension bad enough to outweigh the rest.

## 4. Run metrics

Four end-to-end runs, one per branch, each varying the goal to drive the Master Planner to a different `next_subgoal`:

| Branch | LLM calls | Input tokens | Output tokens | Est. cost | Latency |
|---|---|---|---|---|---|
| forecast | 16 (1 planner + 15 adjuster) | 10,831 | 3,814 | $0.090 | 17.3s |
| inventory | 6 (1 planner + 5 exception) | 4,460 | 1,209 | $0.032 | 11.9s |
| supplier | 2 (1 planner + 1 monitor) | 2,737 | 1,153 | $0.026 | 23.0s |
| logistics | 4 (1 planner + 3 coordinator) | 6,648 | 865 | $0.033 | 13.1s |

Cost estimated at $3/MTok input, $15/MTok output (the rate the assignment's own budget table implies).

Biggest surprise: forecast runs ~3x over the assignment's $0.011 "Forecast Adjuster" line, because the topology calls that node once *per SKU* (15 times), not once per run — the budget assumed a single call. The other three branches land near or under budget. Second surprise, from debugging rather than these numbers: before I filtered on `needs_llm_review`, the inventory branch called its exception-handler LLM on all 15 SKUs regardless of whether EOQ flagged them, which would have made it the most expensive branch by far.

## 5. Primer question reflection

**1. Where does classical catch the LLM, and vice versa?** SKU-007 above is the clean example: the LLM forecast-adjuster read low confidence as decelerating demand and cut the forecast; the classical `detectViolations()`, working from the full series instead of one summary row, correctly identified it as an accelerating viral spike. The reverse also happens by design: EOQ's `declining` flag on SKU-013 catches a case where the closed-form formula alone would confidently recommend reordering into an already 6.75x-overstocked position — the LLM exception handler is what actually stops that.

**2. Unknown `next_subgoal`?** `Route on Subgoal` has `fallbackOutput: "extra"`, and that output has no downstream connection. An unrecognized value like `"audit_warehouse"` dead-ends silently — no error, no `Final Output`. Fix: wire the fallback output to a node that throws explicitly (or emits an `unrecognized_subgoal` result), so it fails loud instead of invisible.

**3. Why is EOQ confidently wrong for SKU-013?** The formula assumes constant demand and just computes `sqrt(2DS/H)` off `annual_demand` — it has no way to know demand is falling, so it returns a normal-looking 397-unit reorder for a product that's already 6.75x overstocked. Only `detectViolations()`'s `declining` check (recent 3-month mean < half the first 3-month mean) catches this before it reaches a human.

**4. Why LLM for supplier scoring, classical for EOQ?** EOQ has one provably-correct closed-form answer once `D`, `S`, `H` are known — a formula beats an LLM guess outright (deterministic, free, auditable). Supplier scoring depends on a business-model judgment call (stockout cost vs. quality-defect cost) that varies by company and needs a natural-language justification, not just a number. Swapping them loses in both directions: LLM-scored EOQ trades a reproducible answer for a noisy one with no upside; formula-scored suppliers would need someone to hand-encode judgment into fixed coefficients and couldn't explain *why*, e.g., that SUP-002's cheap payment terms don't offset its reliability failure.

## Demo video

(https://youtu.be/sCYCfzmqrp4)
