/**
 * supabase-client.js
 *
 * Lazy, cached accessor for the Supabase service client (issue #1087).
 *
 * The exact same module-level promise-caching pattern was previously
 * duplicated at the top of src/routes/payments.js and
 * src/services/paymentService.js. Centralizing it here keeps a single
 * dynamic import per process and removes the copy-paste drift risk.
 */

let supabaseClientPromise;

async function getSupabaseClient() {
  if (!supabaseClientPromise) {
    supabaseClientPromise = import("./supabase.js").then((module) => module.supabase);
  }

  return supabaseClientPromise;
}

export { getSupabaseClient };
