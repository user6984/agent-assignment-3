/**
 * Classical Logistics Planner — greedy fallback.
 *
 * Pedagogical purpose
 * -------------------
 * This is the "planning without an LLM" branch of the Logistics Coordinator.
 * The LLM logistics node handles soft-constraint cases (special instructions,
 * supplier relationships, urgency framing, multi-leg trade-offs). When the
 * upstream IF node decides a situation is purely numerical — fixed weight,
 * fixed deadline, available carriers — it routes here for a deterministic,
 * auditable choice.
 *
 * Greedy is the simplest classical search: at each decision point, take the
 * locally best option. It's not always globally optimal, but it's fast,
 * explainable, and a perfect baseline to compare LLM plans against.
 *
 * Reading: docs/planning-primer.md §"Classical search and the cost of optimality"
 */

// The main input carries only the request(s) routed here by the "Use
// Classical Fallback?" IF node (already merged with the LLM's parsed
// decision upstream). The options catalogue is pulled by cross-node
// reference -- it already ran earlier in this same execution -- and merged
// in here so this node sees the same heterogeneous list its main loop
// expects.
//
// A request: { type: "request", request_id, weight_kg, origin_region,
//              dest_region, deadline_days, perishable }
// An option: { type: "option",  option_id, carrier, mode, origin_region,
//              destination_region, transit_days, cost_per_kg,
//              max_weight_kg, supports_perishable }

const all = [
  ...$input.all().map(i => i.json),
  ...$('Read Shipping JSON').all().map(i => ({ type: "option", ...i.json })),
];
const requests = all.filter(x => x.type === "request");
const options  = all.filter(x => x.type === "option");

// ---- TODO — greedy carrier assignment -------------------------------------

/**
 * Pick the cheapest shipping option satisfying ALL hard constraints
 * for one request:
 *   - origin_region matches request.origin_region
 *   - destination_region matches request.dest_region
 *   - transit_days <= request.deadline_days
 *   - max_weight_kg >= request.weight_kg
 *   - if request.perishable === true, supports_perishable must also be true
 *
 * Total cost = request.weight_kg × option.cost_per_kg  (we ignore time cost)
 *
 * @param {object} req
 * @param {Array}  options
 * @returns {object|null}  Chosen option augmented with `total_cost_usd`,
 *                         or null if nothing satisfies the constraints.
 *
 * Hint: this is two steps — filter, then min-by-cost.
 *   1. Array.prototype.filter against the 5 hard constraints.
 *   2. If the filtered list is empty, return null (infeasible).
 *   3. Map each survivor to {...option, total_cost_usd: req.weight_kg * option.cost_per_kg}.
 *   4. Reduce to the one with the minimum total_cost_usd.
 *
 * Why greedy and not exhaustive? With ~10 options per request the search
 * space is trivial. We use greedy to keep the comparison clean against
 * the LLM branch, not because we couldn't afford the optimal search.
 */
function pickCheapestFeasible(req, options) {
  const feasible = options.filter(opt =>
    opt.origin_region === req.origin_region &&
    opt.destination_region === req.dest_region &&
    opt.transit_days <= req.deadline_days &&
    opt.max_weight_kg >= req.weight_kg &&
    (!req.perishable || opt.supports_perishable)
  );

  if (feasible.length === 0) return null;

  const priced = feasible.map(opt => ({
    ...opt,
    total_cost_usd: req.weight_kg * opt.cost_per_kg,
  }));

  return priced.reduce((cheapest, opt) =>
    opt.total_cost_usd < cheapest.total_cost_usd ? opt : cheapest
  );
}

// ---- Main loop (provided) -------------------------------------------------

const assignments = [];
for (const req of requests) {
  const choice = pickCheapestFeasible(req, options);
  assignments.push({
    request_id: req.request_id,
    weight_kg: req.weight_kg,
    deadline_days: req.deadline_days,
    chosen: choice,
    feasible: choice !== null,
    method: "classical_greedy",
  });
}

return assignments.map(a => ({ json: a }));
