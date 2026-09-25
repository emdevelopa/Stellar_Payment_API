/**
 * migration_20260530000000_asset_issuer_optimizations.js
 * 
 * Task #753: Optimized SQL queries for asset and issuer data
 */

export function up(knex) {
    return knex.schema
        .createTable('asset_issuer_verifications', (table) => {
            table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
            table.uuid('merchant_id').references('id').inTable('merchants');
            table.string('asset_code').notNullable();
            table.string('asset_issuer').notNullable();
            table.boolean('is_valid').notNullable();
            table.string('verification_type').notNullable(); // e.g., 'on-chain', 'signature'
            table.text('reason');
            table.jsonb('metadata');
            table.timestamp('created_at').defaultTo(knex.fn.now());
        })
        .then(() => {
            return knex.schema.table('payments', (table) => {
                // Optimized index for asset-based lookups
                table.index(['asset', 'asset_issuer', 'status'], 'idx_payments_asset_issuer_status');
            });
        });
}

export function down(knex) {
    return knex.schema
        .dropTableIfExists('asset_issuer_verifications')
        .then(() => {
            return knex.schema.table('payments', (table) => {
                table.dropIndex(['asset', 'asset_issuer', 'status'], 'idx_payments_asset_issuer_status');
            });
        });
}
