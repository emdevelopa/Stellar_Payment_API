import { getWebhookSecretsEncryptionKey } from "./secret-crypto.js";

function validateEnvironmentVariables() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STELLAR_NETWORK',
    'DATABASE_URL',
    'REDIS_URL',
    'WEBHOOK_SECRET_ENCRYPTION_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => {
      console.error(`   - ${key}`);
    });
    console.error('\nPlease set these variables in your .env file or environment.');
    process.exit(1);
  }

  const validNetworks = ['testnet', 'public'];
  if (!validNetworks.includes(process.env.STELLAR_NETWORK)) {
    console.error(`❌ Invalid STELLAR_NETWORK: ${process.env.STELLAR_NETWORK}`);
    console.error(`Valid options: ${validNetworks.join(', ')}`);
    process.exit(1);
  }

  const optionalPositiveIntegers = [
    'CREATE_PAYMENT_RATE_LIMIT_MAX',
    'CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS',
    'LOG_RETENTION_DAYS',
    'LOG_PURGE_BATCH_SIZE',
    'LOG_PURGE_MAX_DURATION_MS',
  ];

  for (const key of optionalPositiveIntegers) {
    const value = process.env[key];

    if (!value) {
      continue;
    }

    const parsedValue = Number.parseInt(value, 10);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      console.error(`❌ Invalid ${key}: ${value}`);
      console.error(`${key} must be a positive integer.`);
      process.exit(1);
    }
  }

  try {
    getWebhookSecretsEncryptionKey();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  console.log('✅ Environment variables validated');
}

export { validateEnvironmentVariables };
