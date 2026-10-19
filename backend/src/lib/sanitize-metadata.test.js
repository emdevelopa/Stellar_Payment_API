import { describe, it, expect } from 'vitest'
import { validateMetadata, sanitizeMetadataMiddleware } from './sanitize-metadata.js'

describe('validateMetadata', () => {
  it('allows null metadata', () => {
    const result = validateMetadata(null)
    expect(result.valid).toBe(true)
    expect(result.sanitized).toBe(null)
  })

  it('allows undefined metadata', () => {
    const result = validateMetadata(undefined)
    expect(result.valid).toBe(true)
    expect(result.sanitized).toBe(null)
  })

  it('allows simple valid object', () => {
    const metadata = { orderId: '12345', customerName: 'John' }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    expect(result.sanitized).toHaveProperty('orderId')
  })

  it('rejects non-object metadata', () => {
    const result = validateMetadata('string')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('must be a JSON object')
  })

  it('rejects nesting deeper than 4 levels', () => {
    const metadata = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: 'too deep'
            }
          }
        }
      }
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('nesting depth exceeds')
  })

  it('allows nesting up to 4 levels', () => {
    const metadata = {
      level1: {
        level2: {
          level3: {
            level4: 'ok'
          }
        }
      }
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
  })

  it('removes XSS script tags', () => {
    const metadata = {
      description: '<script>alert("xss")</script>Hello'
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    expect(result.sanitized.description).not.toContain('<script>')
    expect(result.sanitized.description).not.toContain('alert')
  })

  it('removes javascript: protocol', () => {
    const metadata = {
      link: 'javascript:alert(1)'
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    expect(result.sanitized.link).not.toContain('javascript:')
  })

  it('removes event handlers', () => {
    const metadata = {
      html: '<img src=x onerror=alert(1)>'
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    expect(result.sanitized.html).not.toContain('onerror=')
  })

  it('removes NoSQL injection patterns ($where)', () => {
    const metadata = {
      query: { $where: 'this.password == "test"' }
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    const sanitized = JSON.stringify(result.sanitized)
    expect(sanitized).not.toContain('$where')
  })

  it('removes NoSQL injection patterns ($ne, $gt, $lt)', () => {
    const metadata = {
      filter: { price: { $gt: 0, $lt: 100, $ne: 50 } }
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    const sanitized = JSON.stringify(result.sanitized)
    expect(sanitized).not.toContain('$gt')
    expect(sanitized).not.toContain('$lt')
    expect(sanitized).not.toContain('$ne')
  })

  it('HTML encodes special characters', () => {
    const metadata = {
      text: '<div>"Hello" & \'World\'</div>'
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    expect(result.sanitized.text).toContain('&lt;')
    expect(result.sanitized.text).toContain('&gt;')
    expect(result.sanitized.text).toContain('&quot;')
    expect(result.sanitized.text).toContain('&#x27;')
    expect(result.sanitized.text).toContain('&amp;')
  })

  it('truncates overly long strings', () => {
    const longString = 'a'.repeat(2000)
    const metadata = { description: longString }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    expect(result.sanitized.description.length).toBeLessThanOrEqual(1000)
  })

  it('rejects metadata with too many keys', () => {
    const metadata = {}
    for (let i = 0; i < 60; i++) {
      metadata[`key${i}`] = 'value'
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('too many keys')
  })

  it('sanitizes nested arrays', () => {
    const metadata = {
      items: [
        { name: '<script>xss</script>Product' },
        { name: 'Normal Product' }
      ]
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    expect(result.sanitized.items[0].name).not.toContain('<script>')
  })

  it('sanitizes key names', () => {
    const metadata = {
      '<script>key</script>': 'value'
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    const keys = Object.keys(result.sanitized)
    expect(keys[0]).not.toContain('<script>')
  })

  it('handles mixed valid and malicious content', () => {
    const metadata = {
      orderId: '12345',
      customerName: 'John Doe',
      notes: '<script>alert("xss")</script>Important note',
      tags: ['tag1', 'javascript:void(0)', 'tag3']
    }
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(true)
    expect(result.sanitized.orderId).toBe('12345')
    expect(result.sanitized.customerName).toContain('John')
    expect(result.sanitized.notes).not.toContain('<script>')
    expect(result.sanitized.tags[1]).not.toContain('javascript:')
  })
})

describe('validateMetadata — prototype pollution (issue #1447)', () => {
  it('rejects a top-level __proto__ key parsed from JSON', () => {
    const metadata = JSON.parse('{"__proto__": {"isAdmin": true}, "ok": 1}')
    const result = validateMetadata(metadata)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('forbidden key')
    expect({}.isAdmin).toBeUndefined()
  })

  it('rejects nested constructor / prototype keys', () => {
    expect(validateMetadata({ a: { constructor: { prototype: {} } } }).valid).toBe(false)
    expect(validateMetadata({ list: [{ prototype: 1 }] }).valid).toBe(false)
  })

  it('still accepts keys that merely contain the forbidden words', () => {
    const result = validateMetadata({ constructor_name: 'x', proto: 'y' })
    expect(result.valid).toBe(true)
    expect(result.sanitized.constructor_name).toBe('x')
  })
})

describe('sanitizeMetadataMiddleware', () => {
  it('passes through when no metadata in request', () => {
    const req = { body: {} }
    const res = {}
    let nextCalled = false
    const next = () => { nextCalled = true }

    sanitizeMetadataMiddleware(req, res, next)

    expect(nextCalled).toBe(true)
  })

  it('sanitizes valid metadata and calls next', () => {
    const req = {
      body: {
        metadata: { orderId: '123', note: '<script>xss</script>' }
      }
    }
    const res = {}
    let nextCalled = false
    const next = () => { nextCalled = true }

    sanitizeMetadataMiddleware(req, res, next)

    expect(nextCalled).toBe(true)
    expect(req.body.metadata.note).not.toContain('<script>')
  })

  it('returns 400 for invalid metadata', () => {
    const req = {
      body: {
        metadata: {
          level1: { level2: { level3: { level4: { level5: 'too deep' } } } }
        }
      }
    }
    let statusCode
    let responseBody
    const res = {
      status: (code) => {
        statusCode = code
        return {
          json: (body) => { responseBody = body }
        }
      }
    }
    const next = () => {}

    sanitizeMetadataMiddleware(req, res, next)

    expect(statusCode).toBe(400)
    expect(responseBody.error).toContain('nesting depth')
  })
})
