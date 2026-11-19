import type { ImageGenerationProviderErrorCategory } from '../../../src/types/providers.ts';

export const OVHCLOUD_PROVIDER_ID = 'ovhcloud' as const;
export const OVHCLOUD_PROVIDER_NAME = 'OVHcloud AI Endpoints' as const;
export const OVHCLOUD_SDXL_MODEL_ID = 'stable-diffusion-xl-base-v10' as const;
export const OVHCLOUD_SDXL_ENDPOINT_URL =
  'https://stable-diffusion-xl.endpoints.kepler.ai.cloud.ovh.net/api/text2image' as const;

export const OVH_ACCESS_TOKEN_ENV_VAR = 'OVH_AI_ENDPOINTS_ACCESS_TOKEN' as const;
export const OVH_MODEL_ID_ENV_VAR = 'OVH_AI_ENDPOINTS_MODEL_ID' as const;
export const OVH_ALLOW_ANONYMOUS_ENV_VAR = 'OVH_AI_ENDPOINTS_ALLOW_ANONYMOUS' as const;
export const OVH_FREE_TIER_AVAILABLE_ENV_VAR =
  'OVH_AI_ENDPOINTS_FREE_TIER_AVAILABLE' as const;

export const OVH_ANONYMOUS_RATE_LIMIT_RPM = 2;
export const OVH_AUTHENTICATED_RATE_LIMIT_RPM = 400;

const PLACEHOLDER_TOKEN_VALUES = new Set([
  'my_ovh_ai_endpoints_access_token',
  'your_ovh_ai_endpoints_access_token',
  'ovh_ai_endpoints_access_token',
  'placeholder',
  'changeme',
  'replace_me',
]);

const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/;

export type OvhcloudEnvSource = Readonly<Record<string, string | undefined>>;

export interface OvhcloudPublicConfiguration {
  readonly providerId: typeof OVHCLOUD_PROVIDER_ID;
  readonly providerName: typeof OVHCLOUD_PROVIDER_NAME;
  readonly endpointUrl: string;
  readonly credentialEnvVar: typeof OVH_ACCESS_TOKEN_ENV_VAR;
  readonly modelEnvVar: typeof OVH_MODEL_ID_ENV_VAR;
  readonly modelId: string;
  readonly modelValid: boolean;
  readonly isFreeTierModel: boolean;
  readonly freeTierAvailable: boolean;
  readonly tokenConfigured: boolean;
  readonly anonymousFreeTierEnabled: boolean;
  readonly accessMode: 'authenticated' | 'anonymous_free_tier' | 'disabled';
  readonly configurationStatus: 'configured' | 'not_configured' | 'invalid';
  readonly configurationMessage: string;
  readonly setupInstruction?: string;
  readonly errorCategory?: ImageGenerationProviderErrorCategory;
  readonly warnings: readonly string[];
}

export function isUsableOvhToken(rawToken: string | undefined): boolean {
  if (typeof rawToken !== 'string') {
    return false;
  }
  const trimmed = rawToken.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return !PLACEHOLDER_TOKEN_VALUES.has(trimmed.toLowerCase());
}

export function parseBooleanFlag(
  rawValue: string | undefined,
  defaultValue: boolean,
): boolean {
  if (rawValue === undefined) {
    return defaultValue;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return defaultValue;
}

export function resolveOvhcloudPublicConfiguration(
  env: OvhcloudEnvSource = process.env,
): OvhcloudPublicConfiguration {
  const tokenConfigured = isUsableOvhToken(env[OVH_ACCESS_TOKEN_ENV_VAR]);
  const anonymousFreeTierEnabled = parseBooleanFlag(
    env[OVH_ALLOW_ANONYMOUS_ENV_VAR],
    false,
  );
  const freeTierAvailable = parseBooleanFlag(
    env[OVH_FREE_TIER_AVAILABLE_ENV_VAR],
    true,
  );

  const rawModel = env[OVH_MODEL_ID_ENV_VAR];
  const requestedModelId =
    typeof rawModel === 'string' && rawModel.trim().length > 0
      ? rawModel.trim()
      : OVHCLOUD_SDXL_MODEL_ID;

  const warnings: string[] = [];

  if (!MODEL_ID_PATTERN.test(requestedModelId)) {
    return {
      providerId: OVHCLOUD_PROVIDER_ID,
      providerName: OVHCLOUD_PROVIDER_NAME,
      endpointUrl: OVHCLOUD_SDXL_ENDPOINT_URL,
      credentialEnvVar: OVH_ACCESS_TOKEN_ENV_VAR,
      modelEnvVar: OVH_MODEL_ID_ENV_VAR,
      modelId: OVHCLOUD_SDXL_MODEL_ID,
      modelValid: false,
      isFreeTierModel: true,
      freeTierAvailable,
      tokenConfigured,
      anonymousFreeTierEnabled,
      accessMode: 'disabled',
      configurationStatus: 'invalid',
      configurationMessage: `${OVH_MODEL_ID_ENV_VAR} contains an invalid model identifier format.`,
      setupInstruction: `Remove ${OVH_MODEL_ID_ENV_VAR} or set it to "${OVHCLOUD_SDXL_MODEL_ID}".`,
      errorCategory: 'INVALID_MODEL_CONFIGURATION',
      warnings,
    };
  }

  if (requestedModelId !== OVHCLOUD_SDXL_MODEL_ID) {
    return {
      providerId: OVHCLOUD_PROVIDER_ID,
      providerName: OVHCLOUD_PROVIDER_NAME,
      endpointUrl: OVHCLOUD_SDXL_ENDPOINT_URL,
      credentialEnvVar: OVH_ACCESS_TOKEN_ENV_VAR,
      modelEnvVar: OVH_MODEL_ID_ENV_VAR,
      modelId: requestedModelId,
      modelValid: false,
      isFreeTierModel: false,
      freeTierAvailable: false,
      tokenConfigured,
      anonymousFreeTierEnabled,
      accessMode: 'disabled',
      configurationStatus: 'invalid',
      configurationMessage: `Model "${requestedModelId}" is blocked. Phase 05.1 permits only free-tier "${OVHCLOUD_SDXL_MODEL_ID}" without paid upgrades.`,
      setupInstruction: `Set ${OVH_MODEL_ID_ENV_VAR}="${OVHCLOUD_SDXL_MODEL_ID}" or unset it to use the free-tier SDXL baseline.`,
      errorCategory: 'INVALID_MODEL_CONFIGURATION',
      warnings,
    };
  }

  if (!freeTierAvailable) {
    return {
      providerId: OVHCLOUD_PROVIDER_ID,
      providerName: OVHCLOUD_PROVIDER_NAME,
      endpointUrl: OVHCLOUD_SDXL_ENDPOINT_URL,
      credentialEnvVar: OVH_ACCESS_TOKEN_ENV_VAR,
      modelEnvVar: OVH_MODEL_ID_ENV_VAR,
      modelId: OVHCLOUD_SDXL_MODEL_ID,
      modelValid: true,
      isFreeTierModel: true,
      freeTierAvailable: false,
      tokenConfigured,
      anonymousFreeTierEnabled,
      accessMode: 'disabled',
      configurationStatus: 'invalid',
      configurationMessage:
        'OVHcloud free-tier Stable Diffusion XL access is currently disabled or unavailable. Automatic paid fallback is prohibited.',
      setupInstruction:
        'Verify free-tier availability on OVHcloud AI Endpoints or re-enable OVH_AI_ENDPOINTS_FREE_TIER_AVAILABLE.',
      errorCategory: 'UNAVAILABLE',
      warnings: [
        'Free-tier SDXL endpoint marked unavailable; paid providers will not be activated automatically.',
      ],
    };
  }

  if (tokenConfigured) {
    return {
      providerId: OVHCLOUD_PROVIDER_ID,
      providerName: OVHCLOUD_PROVIDER_NAME,
      endpointUrl: OVHCLOUD_SDXL_ENDPOINT_URL,
      credentialEnvVar: OVH_ACCESS_TOKEN_ENV_VAR,
      modelEnvVar: OVH_MODEL_ID_ENV_VAR,
      modelId: OVHCLOUD_SDXL_MODEL_ID,
      modelValid: true,
      isFreeTierModel: true,
      freeTierAvailable: true,
      tokenConfigured: true,
      anonymousFreeTierEnabled,
      accessMode: 'authenticated',
      configurationStatus: 'configured',
      configurationMessage: `OVHcloud AI Endpoints token configured for free-tier model "${OVHCLOUD_SDXL_MODEL_ID}".`,
      warnings,
    };
  }

  if (anonymousFreeTierEnabled) {
    warnings.push(
      `Anonymous free-tier mode is active (rate limit: ${OVH_ANONYMOUS_RATE_LIMIT_RPM} requests/minute per IP). Add ${OVH_ACCESS_TOKEN_ENV_VAR} on the server for higher free-tier throughput.`,
    );
    return {
      providerId: OVHCLOUD_PROVIDER_ID,
      providerName: OVHCLOUD_PROVIDER_NAME,
      endpointUrl: OVHCLOUD_SDXL_ENDPOINT_URL,
      credentialEnvVar: OVH_ACCESS_TOKEN_ENV_VAR,
      modelEnvVar: OVH_MODEL_ID_ENV_VAR,
      modelId: OVHCLOUD_SDXL_MODEL_ID,
      modelValid: true,
      isFreeTierModel: true,
      freeTierAvailable: true,
      tokenConfigured: false,
      anonymousFreeTierEnabled: true,
      accessMode: 'anonymous_free_tier',
      configurationStatus: 'configured',
      configurationMessage: `Configured in explicit anonymous free-tier development mode (${OVH_ANONYMOUS_RATE_LIMIT_RPM} RPM limit per IP) for "${OVHCLOUD_SDXL_MODEL_ID}".`,
      setupInstruction: `Optional: set ${OVH_ACCESS_TOKEN_ENV_VAR} in server Secrets to increase free-tier rate limits from ${OVH_ANONYMOUS_RATE_LIMIT_RPM} RPM to ${OVH_AUTHENTICATED_RATE_LIMIT_RPM} RPM.`,
      warnings,
    };
  }

  warnings.push(
    `No server token is configured and anonymous free-tier mode is not pre-enabled. You may configure ${OVH_ACCESS_TOKEN_ENV_VAR} or explicitly confirm an anonymous free-tier test.`,
  );

  return {
    providerId: OVHCLOUD_PROVIDER_ID,
    providerName: OVHCLOUD_PROVIDER_NAME,
    endpointUrl: OVHCLOUD_SDXL_ENDPOINT_URL,
    credentialEnvVar: OVH_ACCESS_TOKEN_ENV_VAR,
    modelEnvVar: OVH_MODEL_ID_ENV_VAR,
    modelId: OVHCLOUD_SDXL_MODEL_ID,
    modelValid: true,
    isFreeTierModel: true,
    freeTierAvailable: true,
    tokenConfigured: false,
    anonymousFreeTierEnabled: false,
    accessMode: 'disabled',
    configurationStatus: 'not_configured',
    configurationMessage: `${OVH_ACCESS_TOKEN_ENV_VAR} is not configured in the server runtime environment.`,
    setupInstruction: `Set ${OVH_ACCESS_TOKEN_ENV_VAR} in AI Studio Secrets (or set ${OVH_ALLOW_ANONYMOUS_ENV_VAR}="true" for 2 RPM anonymous development testing).`,
    errorCategory: 'MISSING_CREDENTIAL',
    warnings,
  };
}

/**
 * Internal server-only token resolver. Never expose or serialize the returned string.
 */
export function resolveOvhcloudAccessToken(
  env: OvhcloudEnvSource = process.env,
): string | null {
  const raw = env[OVH_ACCESS_TOKEN_ENV_VAR];
  if (!isUsableOvhToken(raw) || typeof raw !== 'string') {
    return null;
  }
  return raw.trim();
}
