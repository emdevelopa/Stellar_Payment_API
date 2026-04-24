import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted makes mockCall available inside the vi.mock factory
const { mockTxCall, mockTransaction, mockLoadAccount } = vi.hoisted(() => ({
    mockTxCall: vi.fn(),
    mockTransaction: vi.fn(),
    mockLoadAccount: vi.fn(),
}))

vi.mock('stellar-sdk', async (importOriginal) => {
    const actual = await importOriginal()

    const MockServer = vi.fn(() => ({
        transactions: () => ({
            transaction: (hash) => {
                mockTransaction(hash)
                return {
                    call: mockTxCall
                }
            }
        }),
        loadAccount: mockLoadAccount,
    }))

    const MockTransaction = vi.fn((envelopeXdr, passphrase) => ({
        source: 'GABC123',
        hash: vi.fn(() => Buffer.from('txhashbytes')),
        signatures: envelopeXdr === 'invalid' ? [] : [
            {
                hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])),
                signature: vi.fn(() => Buffer.from('sigbytes')),
            }
        ]
    }))

    const MockKeypair = {
        fromPublicKey: vi.fn(() => ({
            signatureHint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])),
            verify: vi.fn(() => true),
        })),
    }

    return {
        ...actual,
        Horizon: { Server: MockServer },
        Transaction: MockTransaction,
        Keypair: MockKeypair,
        Networks: {
            PUBLIC: 'Public Global Stellar Network ; October 2014',
            TESTNET: 'Test net Stellar Network ; September 2015'
        }
    }
})

import { verifyTransactionSignature } from './stellar.js'

describe('verifyTransactionSignature', () => {
    beforeEach(() => {
        mockTxCall.mockReset()
        mockTransaction.mockReset()
        mockLoadAccount.mockReset()
    })

    it('returns valid=true when transaction has valid signatures and weight meets threshold', async () => {
        mockTxCall.mockResolvedValue({
            envelope_xdr: 'valid-envelope-with-signatures'
        })
        mockLoadAccount.mockResolvedValue({
            thresholds: { med_threshold: 1 },
            signers: [{ key: 'GABC123', weight: 1 }],
        })

        const result = await verifyTransactionSignature('tx-123')
        expect(result.valid).toBe(true)
        expect(result.thresholdMet).toBe(true)
        expect(mockTransaction).toHaveBeenCalledWith('tx-123')
    })

    it('returns valid=false when transaction has no signatures', async () => {
        mockTxCall.mockResolvedValue({
            envelope_xdr: 'invalid'
        })

        const result = await verifyTransactionSignature('tx-empty')
        expect(result.valid).toBe(false)
        expect(result.reason).toMatch(/no signatures/i)
        expect(mockTransaction).toHaveBeenCalledWith('tx-empty')
    })

    it('returns valid=false when transaction fetch fails', async () => {
        mockTxCall.mockRejectedValue(new Error('Horizon error'))

        const result = await verifyTransactionSignature('tx-fail')
        expect(result.valid).toBe(false)
        expect(result.reason).toMatch(/failed to fetch/i)
        expect(mockTransaction).toHaveBeenCalledWith('tx-fail')
    })
})
