# SEP-0001 stellar.toml Generator Guide

This guide explains how to use the SEP-0001 stellar.toml generator to expose your merchant business information according to the Stellar protocol standard.

## Overview

The SEP-0001 standard defines how Stellar anchors and payment processors should publish their business information. The Stellar Payment API automatically generates a `stellar.toml` file for each merchant based on their configuration.

## Accessing stellar.toml

The `stellar.toml` file is available at:

```
GET /.well-known/stellar.toml?merchant_id=<merchant_id>
```

### Public Access

If you're authenticated with an API key, you can omit the `merchant_id` parameter:

```
GET /.well-known/stellar.toml
```

The API will use your authenticated merchant's configuration.

### Example Request

```bash
curl https://api.example.com/.well-known/stellar.toml?merchant_id=550e8400-e29b-41d4-a716-446655440000
```

### Example Response

```toml
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
TRANSFER_SERVER = "https://api.example.com/api"
DOCUMENTATION = "https://api.example.com/api-docs"
ACCOUNTS = ["GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B"]

[ORG]
name = "Acme Payment Services"
contact = "merchant@acme.com"
support = "support@acme.com"
homepage = "https://acme.com"
logo = "https://acme.com/logo.png"
```

## Configuration

The stellar.toml is generated from:

1. **Environment Variables** (server-wide settings):
   - `STELLAR_NETWORK_PASSPHRASE`: Network to use (default: "Test SDF Network ; September 2015")
   - `TRANSFER_SERVER_URL`: Payment endpoint (default: `{API_BASE_URL}/api`)
   - `API_BASE_URL`: Base URL of the API (default: "http://localhost:4000")
   - `FEDERATION_SERVER_URL`: Optional federation server
   - `DOCS_URL`: Documentation URL (default: `{API_BASE_URL}/api-docs`)
   - `SIGNING_KEY`: Optional signing key for transactions

2. **Merchant Settings** (from database):
   - `business_name`: Organization name
   - `email`: Contact email
   - `notification_email`: Support email
   - `recipient`: Stellar account address
   - `branding_config.homepage`: Organization homepage
   - `branding_config.logo_url`: Organization logo URL

## Environment Setup

Configure these environment variables in your `.env` file:

```bash
# Required
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
API_BASE_URL="https://api.example.com"

# Optional
TRANSFER_SERVER_URL="https://api.example.com/api"
FEDERATION_SERVER_URL="https://federation.example.com"
DOCS_URL="https://docs.example.com"
SIGNING_KEY="GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B"
```

## Merchant Configuration

Merchants can configure their stellar.toml information through:

1. **Basic Information** (set during registration):
   - `business_name`: Your organization name
   - `email`: Contact email
   - `notification_email`: Support email

2. **Stellar Account** (set during registration):
   - `recipient`: Your Stellar account address (e.g., `GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B`)

3. **Branding Configuration** (via merchant settings):
   - `branding_config.homepage`: Your website URL
   - `branding_config.logo_url`: Your logo URL

### Example: Setting Branding Configuration

```bash
curl -X POST https://api.example.com/api/merchant-branding \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "homepage": "https://acme.com",
    "logo_url": "https://acme.com/logo.png"
  }'
```

## Generated Fields

### Required Fields

- **NETWORK_PASSPHRASE**: The Stellar network to use
  - Testnet: `"Test SDF Network ; September 2015"`
  - Public: `"Public Global Stellar Network ; September 2015"`

- **TRANSFER_SERVER**: URL of the payment API endpoint
  - Used by wallets to initiate payments
  - Example: `"https://api.example.com/api"`

### Optional Fields

- **FEDERATION_SERVER**: URL for name resolution
  - Allows users to send payments using `username*domain.com` format
  - Example: `"https://federation.example.com"`

- **ACCOUNTS**: List of Stellar accounts operated by the merchant
  - Example: `["GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B"]`

- **DOCUMENTATION**: URL to API documentation
  - Example: `"https://api.example.com/api-docs"`

- **SIGNING_KEY**: Public key for transaction signing
  - Example: `"GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B"`

### Organization Section

The `[ORG]` section contains merchant information:

- **name**: Organization name
- **contact**: Primary contact email
- **support**: Support email
- **homepage**: Organization website
- **logo**: Organization logo URL

## Validation

The stellar.toml is validated to ensure:

1. **Required fields present**: NETWORK_PASSPHRASE and TRANSFER_SERVER
2. **Valid TOML syntax**: Proper formatting and escaping
3. **Valid URLs**: Properly formatted URLs
4. **Valid Stellar addresses**: Properly formatted account addresses

## Caching

The stellar.toml endpoint includes caching headers:

```
Cache-Control: public, max-age=3600
```

This means:
- Responses are cached for 1 hour
- CDNs and browsers will cache the response
- Changes to merchant configuration may take up to 1 hour to propagate

To bypass caching during testing:

```bash
curl -H "Cache-Control: no-cache" https://api.example.com/.well-known/stellar.toml
```

## Integration with Stellar Wallets

Stellar wallets use stellar.toml to:

1. **Discover payment endpoints**: Find the TRANSFER_SERVER URL
2. **Verify merchant identity**: Check the organization information
3. **Display branding**: Show the logo and homepage
4. **Validate accounts**: Verify the merchant's Stellar accounts

### Example: Wallet Integration

```javascript
// Fetch stellar.toml
const response = await fetch('https://api.example.com/.well-known/stellar.toml');
const toml = await response.text();

// Parse TOML (using a TOML parser library)
const config = parseToml(toml);

// Use configuration
console.log('Transfer Server:', config.TRANSFER_SERVER);
console.log('Organization:', config.ORG.name);
console.log('Logo:', config.ORG.logo);
```

## Testing

### Validate stellar.toml Format

Use the Stellar Laboratory to validate your stellar.toml:

1. Go to https://laboratory.stellar.org/
2. Select "SEP-0001" from the menu
3. Enter your stellar.toml URL
4. Click "Validate"

### Manual Testing

```bash
# Fetch stellar.toml
curl https://api.example.com/.well-known/stellar.toml

# Validate TOML syntax
curl https://api.example.com/.well-known/stellar.toml | toml-lint

# Check specific fields
curl https://api.example.com/.well-known/stellar.toml | grep TRANSFER_SERVER
```

### Test with Stellar SDK

```javascript
import { StellarTomlResolver } from 'stellar-sdk';

const domain = 'api.example.com';
const toml = await StellarTomlResolver.resolve(domain);

console.log('Transfer Server:', toml.TRANSFER_SERVER);
console.log('Accounts:', toml.ACCOUNTS);
```

## Troubleshooting

### stellar.toml Not Found

- Ensure the endpoint is accessible at `/.well-known/stellar.toml`
- Check that your merchant_id is valid
- Verify the merchant hasn't been deleted

### Invalid TOML Format

- Check for special characters in merchant information
- Ensure URLs are properly formatted
- Verify email addresses are valid

### Missing Fields

- Ensure merchant has a `business_name` set
- Verify `recipient` (Stellar account) is configured
- Check environment variables are set correctly

### Caching Issues

- Use `Cache-Control: no-cache` header to bypass cache
- Wait 1 hour for changes to propagate
- Clear CDN cache if using a CDN

## Security Considerations

1. **Public Information**: stellar.toml is publicly accessible
   - Don't include sensitive information
   - Only include information you want to share publicly

2. **HTTPS Required**: Always use HTTPS for stellar.toml
   - Wallets will reject HTTP endpoints
   - Ensures data integrity

3. **Validation**: Wallets validate stellar.toml
   - Invalid TOML will be rejected
   - Test thoroughly before deploying

4. **Updates**: Changes may take time to propagate
   - Plan updates in advance
   - Communicate changes to users

## SEP-0001 Standard

For more information about the SEP-0001 standard, see:

- [SEP-0001 Specification](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0030.md)
- [Stellar Documentation](https://developers.stellar.org/docs/learn/fundamentals/stellar-toml)
- [Stellar Laboratory](https://laboratory.stellar.org/)
