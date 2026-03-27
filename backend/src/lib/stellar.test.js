import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted makes mockCall available inside the vi.mock factory (which is hoisted above imports)
const { mockCall, mockTxCall, mockLoadAccount } = vi.hoisted(() => ({
  mockCall: vi.fn(),
  mockTxCall: vi.fn(),
  mockLoadAccount: vi.fn()
}))

vi.mock('stellar-sdk', () => {
  const MockAsset = vi.fn((code, issuer) => ({ isNative: () => false, code, issuer }))
  MockAsset.native = vi.fn(() => ({ isNative: () => true }))

  const MockServer = vi.fn(() => ({
    loadAccount: (...args) => mockLoadAccount(...args),
    payments: () => ({
      forAccount: () => ({
        order: () => ({
          limit: () => ({ call: mockCall })
        })
      })
    }),
    transactions: () => ({
      transaction: () => ({
        call: mockTxCall
      })
    })
  }))

  return { Asset: MockAsset, Horizon: { Server: MockServer } }
})

import { findMatchingPayment } from './stellar.js'

// Helper to build a payment record with sensible defaults
const makePayment = (overrides = {}) => ({
  type: 'payment',
  asset_type: 'native',
  to: 'GABC',
  amount: '100.0000000',
  id: 'op-1',
  transaction_hash: 'tx-abc123',
  ...overrides
})

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

describe('findMatchingPayment', () => {
  beforeEach(() => {
    mockCall.mockReset()
    mockTxCall.mockReset()
    mockLoadAccount.mockReset()
    mockLoadAccount.mockResolvedValue({
      signers: [{ key: 'GABC', weight: 1 }],
      thresholds: { med_threshold: 1 }
    })
  })

  it('returns matching XLM payment', async () => {
    mockCall.mockResolvedValue({ records: [makePayment()] })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM'
    })

    expect(result).toEqual({ id: 'op-1', transaction_hash: 'tx-abc123', is_multisig: false })
  })

  it('returns matching non-native (USDC) payment', async () => {
    mockCall.mockResolvedValue({
      records: [
        makePayment({
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: USDC_ISSUER,
          amount: '50.0000000'
        })
      ]
    })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '50',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER
    })

    expect(result).toEqual({ id: 'op-1', transaction_hash: 'tx-abc123', is_multisig: false })
  })

  it('matches when received amount differs by exactly the tolerance boundary (0.0000001)', async () => {
    mockCall.mockResolvedValue({ records: [makePayment({ amount: '100.0000001' })] })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100.0000000',
      assetCode: 'XLM'
    })

    expect(result).toEqual({ id: 'op-1', transaction_hash: 'tx-abc123', is_multisig: false })
  })

  it('returns null when amount difference exceeds tolerance', async () => {
    mockCall.mockResolvedValue({ records: [makePayment({ amount: '99.9999990' })] })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM'
    })

    expect(result).toBeNull()
  })

  it('returns null when record list is empty', async () => {
    mockCall.mockResolvedValue({ records: [] })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM'
    })

    expect(result).toBeNull()
  })

  it('skips non-payment type records (path_payment, create_account, etc.)', async () => {
    mockCall.mockResolvedValue({
      records: [
        makePayment({ type: 'path_payment_strict_send' }),
        makePayment({ type: 'create_account' })
      ]
    })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM'
    })

    expect(result).toBeNull()
  })

  it('skips payments for the wrong asset', async () => {
    mockCall.mockResolvedValue({
      records: [
        makePayment({
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: USDC_ISSUER
        })
      ]
    })

    // Asking for XLM, record is USDC — should not match
    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM'
    })

    expect(result).toBeNull()
  })

  it('returns the first matching payment when multiple records are present', async () => {
    mockCall.mockResolvedValue({
      records: [
        makePayment({ id: 'op-first', transaction_hash: 'tx-first' }),
        makePayment({ id: 'op-second', transaction_hash: 'tx-second' })
      ]
    })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM'
    })

    expect(result).toEqual({ id: 'op-first', transaction_hash: 'tx-first', is_multisig: false })
  })

  // ── Memo matching (Issue #16) ──────────────────────────────────────

  it('matches payment with correct text memo', async () => {
    mockCall.mockResolvedValue({ records: [makePayment()] })
    mockTxCall.mockResolvedValue({ memo_type: 'text', memo: 'order-123' })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM',
      memo: 'order-123',
      memoType: 'text'
    })

    expect(result).toEqual({ id: 'op-1', transaction_hash: 'tx-abc123', is_multisig: false })
  })

  it('rejects payment with wrong memo value', async () => {
    mockCall.mockResolvedValue({ records: [makePayment()] })
    mockTxCall.mockResolvedValue({ memo_type: 'text', memo: 'wrong-memo' })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM',
      memo: 'order-123',
      memoType: 'text'
    })

    expect(result).toBeNull()
  })

  it('rejects payment with wrong memo type', async () => {
    mockCall.mockResolvedValue({ records: [makePayment()] })
    mockTxCall.mockResolvedValue({ memo_type: 'id', memo: '12345' })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM',
      memo: '12345',
      memoType: 'text'
    })

    expect(result).toBeNull()
  })

  it('matches id memo type', async () => {
    mockCall.mockResolvedValue({ records: [makePayment()] })
    mockTxCall.mockResolvedValue({ memo_type: 'id', memo: '9876' })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM',
      memo: '9876',
      memoType: 'id'
    })

    expect(result).toEqual({ id: 'op-1', transaction_hash: 'tx-abc123', is_multisig: false })
  })

  it('matches hash memo type', async () => {
    const hash = 'abc123def456'
    mockCall.mockResolvedValue({ records: [makePayment()] })
    mockTxCall.mockResolvedValue({ memo_type: 'hash', memo: hash })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM',
      memo: hash,
      memoType: 'hash'
    })

    expect(result).toEqual({ id: 'op-1', transaction_hash: 'tx-abc123', is_multisig: false })
  })

  it('skips memo check when no memo is provided', async () => {
    mockCall.mockResolvedValue({ records: [makePayment()] })

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM'
    })

    expect(result).toEqual({ id: 'op-1', transaction_hash: 'tx-abc123', is_multisig: false })
    expect(mockTxCall).not.toHaveBeenCalled()
  })

  it('skips payment when transaction fetch fails during memo check', async () => {
    mockCall.mockResolvedValue({ records: [makePayment()] })
    mockTxCall.mockRejectedValue(new Error('tx fetch failed'))

    const result = await findMatchingPayment({
      recipient: 'GABC',
      amount: '100',
      assetCode: 'XLM',
      memo: 'order-123',
      memoType: 'text'
    })

    expect(result).toBeNull()
  })

  // ── Horizon error handling (Issue #5) ──────────────────────────────

  it('throws descriptive error on rate limit (429)', async () => {
    mockCall.mockRejectedValue({ response: { status: 429 } })

    await expect(
      findMatchingPayment({ recipient: 'GABC', amount: '100', assetCode: 'XLM' })
    ).rejects.toThrow(/rate limit/i)
  })

  it('throws descriptive error on account not found (404)', async () => {
    mockCall.mockRejectedValue({ response: { status: 404 } })

    await expect(
      findMatchingPayment({ recipient: 'GABC', amount: '100', assetCode: 'XLM' })
    ).rejects.toThrow(/not found/i)
  })

  it('throws descriptive error on Horizon server error (500)', async () => {
    mockCall.mockRejectedValue({ response: { status: 500 } })

    await expect(
      findMatchingPayment({ recipient: 'GABC', amount: '100', assetCode: 'XLM' })
    ).rejects.toThrow(/server error/i)
  })

  it('throws descriptive error on network failure', async () => {
    mockCall.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      findMatchingPayment({ recipient: 'GABC', amount: '100', assetCode: 'XLM' })
    ).rejects.toThrow(/unable to connect/i)
  })

  it('sets status 429 for rate-limit errors', async () => {
    mockCall.mockRejectedValue({ response: { status: 429 } })

    try {
      await findMatchingPayment({ recipient: 'GABC', amount: '100', assetCode: 'XLM' })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err.status).toBe(429)
    }
  })

  it('sets status 502 for network errors', async () => {
    mockCall.mockRejectedValue(new Error('ECONNREFUSED'))

    try {
      await findMatchingPayment({ recipient: 'GABC', amount: '100', assetCode: 'XLM' })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err.status).toBe(502)
    }
  })
})
