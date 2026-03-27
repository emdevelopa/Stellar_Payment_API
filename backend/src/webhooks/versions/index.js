import * as v1 from './v1.js';

// Map of supported webhook payload versions
const versions = {
  'v1': v1
};

/**
 * Resolves the payload builder for the given merchant webhook version.
 * Falls back to 'v1' if the version is missing or unrecognized.
 * 
 * @param {string} version - The merchant's assigned webhook version (e.g., 'v1').
 * @param {Object} eventData - The internal event data to format.
 * @returns {Object} The versioned payload ready to be sent.
 */
export function getPayloadForVersion(version, eventData) {
  const targetVersion = version && versions[version] ? version : 'v1';
  const builder = versions[targetVersion];
  
  return builder.buildPayload(eventData);
}
