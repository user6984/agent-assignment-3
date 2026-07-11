/**
 * Inventory Optimization Planner — Economic Order Quantity (EOQ).
 *
 * Pedagogical purpose
 * -------------------
 * EOQ (Wilson, 1934) is the canonical *classical* operations-research model:
 * a closed-form solution under strict assumptions —
 *   - constant demand
 *   - instantaneous replenishment
 *   - no stockouts allowed
 *   - fixed ordering cost, fixed holding cost
 *   - no quantity discounts
 *
 * Real e-commerce violates ALL of these for at least some SKUs. Viral
 * products (looking at you, SKU-007) blow past "constant demand." Discontinued
 * SKUs (SKU-013) make "no stockouts" expensive in the wrong direction.
 * Slow-movers make the formula numerically unstable.
 *
 * This node teaches the boundary problem: classical algorithms give crisp
 * answers exactly when their assumptions hold. Your two TODOs are
 *   (a) implement the formula
 *   (b) detect when its assumptions don't hold for a given SKU
 *
 * The downstream LLM exception node handles the SKUs you flag.
 *
 * Reading: docs/planning-primer.md §"STRIPS-style assumptions and where they break"
 */

// This node's main input only carries the Master Planner's routing signal
// (that's what fires the branch). The actual inventory + sales rows are
// pulled by cross-node reference -- both CSV-parse nodes already ran
// earlier in this same execution -- giving a heterogeneous list. Partition
// them by which fields are present.
const all = [
  ...$('Read Inventory JSON').all().map(i => i.json),
  ...$('Read Sales JSON').all().map(i => i.json),
];

// Default ordering cost (S in the EOQ formula). In production this would
// vary by supplier and channel; we hard-code a single value so the focus
// stays on the formula and its assumptions.
const ORDERING_COST_USD = 50;

// ---- Helpers (provided) ---------------------------------------------------

function partition(rows) {
  const inventory = rows.filter(r => "on_hand" in r);
  const sales = rows.filter(r => "units_sold" in r);
  return { inventory, sales };
}

function annualDemand(salesForSku) {
  // Sum units_sold across the rows we have. With 12 months of data this is
  // the trailing-12-months annual demand.
  return salesForSku.reduce((acc, r) => acc + Number(r.units_sold), 0);
}

// ---- TODO #1 — the EOQ formula --------------------------------------------

/**
 * Wilson's Economic Order Quantity:
 *
 *   Q* = sqrt( (2 * D * S) / H )
 *
 * @param {number} D  Annual demand        (units per year)
 * @param {number} S  Fixed cost per order (dollars per order)
 * @param {number} H  Holding cost         (dollars per unit per year)
 * @returns {number}  Optimal order quantity, rounded to nearest integer.
 *
 * Hint: Math.sqrt is your friend. Guard against D=0 and H=0 — return 0 in
 *       either case. (You can't optimally order anything for zero demand,
 *       and dividing by zero holding cost is meaningless.)
 */
function eoq(D, S, H) {
  if (D === 0 || H === 0) return 0;
  return Math.round(Math.sqrt((2 * D * S) / H));
}

// ---- TODO #2 — assumption-violation detection -----------------------------

/**
 * EOQ assumes:
 *   (a) demand is roughly constant
 *   (b) lead time is short enough to re-order before stocking out
 *   (c) the SKU isn't perishable (no holding-cost cliff)
 *   (d) demand volume is high enough that an "optimal batch" is meaningful
 *
 * Return an array of human-readable flag strings for any assumption that
 * FAILS for this SKU. An empty array means "EOQ is trustworthy here, ship
 * the formula's recommendation."
 *
 * Suggested checks (refine as you wish):
 *   - "viral_spike"   : mean(last 3 months) > 2.5 × mean(prior 9 months)
 *   - "declining"     : mean(last 3 months) < 0.5 × mean(first 3 months)
 *   - "low_velocity"  : annualDemand < 60   (less than ~5/month average)
 *   - "long_lead_time": inv.lead_time_days > 28 AND demand is volatile
 *
 * Note on perishability: none of our demo SKUs are perishable, so you do
 * NOT need a perishability check. Document the omission in your analysis
 * write-up — a real implementation would need it.
 *
 * @param {object} inv         Inventory row for the SKU
 * @param {Array}  salesSeries Chronologically sorted sales rows for the SKU
 * @returns {Array<string>}    Flag names, e.g. ["viral_spike", "low_velocity"]
 *
 * Hint: implement each check as its own small block. A flagged SKU may
 *       trigger multiple flags — that's expected and useful downstream.
 */
function detectViolations(inv, salesSeries) {
  const flags = [];
  if (salesSeries.length === 0) return flags;

  const mean = rows =>
    rows.length === 0 ? 0 : rows.reduce((acc, r) => acc + Number(r.units_sold), 0) / rows.length;

  const recentThree = salesSeries.slice(-3);
  const priorNine = salesSeries.slice(0, Math.max(0, salesSeries.length - 3));
  const firstThree = salesSeries.slice(0, 3);

  const recentMean = mean(recentThree);
  const priorMean = mean(priorNine);
  const firstMean = mean(firstThree);

  if (priorMean > 0 && recentMean > 2.5 * priorMean) {
    flags.push("viral_spike");
  }

  if (firstMean > 0 && recentMean < 0.5 * firstMean) {
    flags.push("declining");
  }

  const D = annualDemand(salesSeries);
  if (D < 60) {
    flags.push("low_velocity");
  }

  // Volatility = coefficient of variation across the full series. A long
  // lead time only matters if demand can't be trusted to hold steady while
  // we wait for the reorder to arrive.
  const overallMean = mean(salesSeries);
  const variance = overallMean > 0
    ? salesSeries.reduce((acc, r) => acc + Math.pow(Number(r.units_sold) - overallMean, 2), 0) / salesSeries.length
    : 0;
  const cv = overallMean > 0 ? Math.sqrt(variance) / overallMean : 0;
  const volatile = cv > 0.5;

  if (Number(inv.lead_time_days) > 28 && volatile) {
    flags.push("long_lead_time");
  }

  return flags;
}

// ---- Main loop (provided) -------------------------------------------------

const { inventory, sales } = partition(all);
const salesBySku = sales.reduce((acc, r) => {
  (acc[r.sku] = acc[r.sku] || []).push(r);
  return acc;
}, {});
for (const sku of Object.keys(salesBySku)) {
  salesBySku[sku].sort((a, b) => a.month.localeCompare(b.month));
}

const results = [];
for (const inv of inventory) {
  const series = salesBySku[inv.sku] || [];
  const D = annualDemand(series);
  const H = Number(inv.holding_cost_per_unit_year);
  const Q = eoq(D, ORDERING_COST_USD, H);
  const flags = detectViolations(inv, series);

  results.push({
    sku: inv.sku,
    name: inv.name,
    on_hand: Number(inv.on_hand),
    reorder_point: Number(inv.reorder_point),
    annual_demand: D,
    eoq_units: Q,
    holding_cost_per_unit_year: H,
    ordering_cost_usd: ORDERING_COST_USD,
    assumption_flags: flags,
    needs_llm_review: flags.length > 0,
  });
}

return results.map(r => ({ json: r }));
