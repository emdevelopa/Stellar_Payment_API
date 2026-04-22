export const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export const DEFAULT_BRANDING_CONFIG = {
  primary_color: "#5ef2c0",
  secondary_color: "#b8ffe2",
  background_color: "#050608",
  logo_url: null,
};

export function sanitizeBrandingConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const source = input;
  const config = {};

  if (typeof source.primary_color === "string") {
    config.primary_color = source.primary_color.trim();
  }
  if (typeof source.secondary_color === "string") {
    config.secondary_color = source.secondary_color.trim();
  }
  if (typeof source.background_color === "string") {
    config.background_color = source.background_color.trim();
  }
  if (typeof source.logo_url === "string") {
    config.logo_url = source.logo_url.trim();
  }

  return Object.keys(config).length > 0 ? config : null;
}

export function resolveBrandingConfig({
  merchantBranding = null,
  brandingOverrides = null,
} = {}) {
  const merchant = sanitizeBrandingConfig(merchantBranding);
  const overrides = sanitizeBrandingConfig(brandingOverrides);

  return {
    ...DEFAULT_BRANDING_CONFIG,
    ...(merchant || {}),
    ...(overrides || {}),
  };
}
