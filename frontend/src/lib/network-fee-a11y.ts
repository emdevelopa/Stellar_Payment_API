/**
 * Screen reader text for the network fee estimate (#1869).
 *
 * The visible fee ("~0.00001 XLM") is terse and tilde-prefixed, which
 * assistive technology reads poorly. These helpers build the full phrase that
 * is announced instead, kept pure so the wording can be tested without
 * rendering.
 */

import type { NetworkFeeData } from "@/hooks/useNetworkFee";

/** Announced while the estimate is being fetched. */
export const NETWORK_FEE_LOADING_LABEL = "Loading network fee estimate";

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Full spoken description of a fee estimate, e.g.
 * "Estimated network fee: about 0.00001 XLM, 100 stroops for 1 operation."
 */
export function describeNetworkFee(fee: NetworkFeeData): string {
  const stroops = plural(fee.stroops, "stroop");
  const operations = plural(fee.operation_count, "operation");
  return `Estimated network fee: about ${fee.xlm} XLM, ${stroops} for ${operations}.`;
}
