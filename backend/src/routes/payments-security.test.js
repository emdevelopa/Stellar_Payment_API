import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import createPaymentsRouter from './payments.js';

// Mock dependencies
vi.mock('../lib/supabase.js', () => ({
    supabase: {
        from: vi.fn(() => ({
            insert: vi.fn(() => Promise.resolve({ error: null })),
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    is: vi.fn(() => ({
                        maybeSingle: vi.fn(() => Promise.resolve({ data: {}, error: null }))
                    }))
                }))
            }))
        }))
    }
}));

vi.mock('../lib/stellar.js', () => ({
    findMatchingPayment: vi.fn(),
    findAnyRecentPayment: vi.fn(),
    findStrictReceivePaths: vi.fn(),
    createRefundTransaction: vi.fn(),
    getNetworkFeeStats: vi.fn(),
    isValidStellarPublicKey: vi.fn(() => true),
    validateMemo: vi.fn(() => ({ valid: true })),
    verifyTransactionSignature: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
    connectRedisClient: vi.fn(() => Promise.resolve({})),
    getCachedPayment: vi.fn(),
    setCachedPayment: vi.fn(),
    invalidatePaymentCache: vi.fn(),
}));

describe('Payments Security - Metadata Sanitization', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        // Mock merchant middleware
        app.use((req, res, next) => {
            req.merchant = { id: 'm1', payment_limits: {} };
            next();
        });
        app.use('/api', createPaymentsRouter());
    });

    it('sanitizes metadata on payment creation', async () => {
        const maliciousMetadata = {
            note: '<script>alert("xss")</script>Hello',
            nested: {
                link: 'javascript:alert(1)'
            }
        };

        // Need to capture the payload sent to supabase
        const { supabase } = await import('../lib/supabase.js');
        const insertMock = vi.fn(() => Promise.resolve({ error: null }));
        supabase.from.mockReturnValue({ insert: insertMock });

        const response = await request(app)
            .post('/api/create-payment')
            .send({
                amount: 10,
                asset: 'XLM',
                recipient: 'GC...',
                metadata: maliciousMetadata
            });

        expect(response.status).toBe(201);

        // Check what was sent to supabase
        const payload = insertMock.mock.calls[0][0];
        // The implementation removes <script> tags entirely before escaping
        expect(payload.metadata.note).not.toContain('<script>');
        expect(payload.metadata.note).not.toContain('alert');
        expect(payload.metadata.note).toBe('Hello');
        expect(payload.metadata.nested.link).not.toContain('javascript:');
    });
});
