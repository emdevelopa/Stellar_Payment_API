import * as crypto from 'crypto';
import { Keypair } from 'stellar-sdk';
import { logger } from '../src/lib/logging'; // assuming a generic logger exists, or we can use console

export function verifySignature(
  payload: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    // Basic validation
    if (!payload || !signature || !publicKey) {
      logger.error({ event: "signature_verification_failed", reason: "missing_parameters" });
      return false;
    }

    // Stellar SDK verification primitive
    const keypair = Keypair.fromPublicKey(publicKey);
    const isValid = keypair.verify(Buffer.from(payload), Buffer.from(signature, 'base64'));
    
    if (!isValid) {
      logger.error({ event: "signature_verification_failed", reason: "invalid_signature" });
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error({ event: "signature_verification_failed", reason: "invalid_signature", details: error.message });
    return false;
  }
}
