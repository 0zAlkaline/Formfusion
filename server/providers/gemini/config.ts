import type { GeminiErrorCategory } from '../../../src/types/providers.ts';

export const GEMINI_PROVIDER_ID = 'gemini' as const;
export const GEMINI_PROVIDER_NAME = 'Google Gemini' as const;
export const GEMINI_API_KEY_ENV_VAR = 'GEMINI_API_KEY' as const;
export const GEMINI_MODEL_ID_ENV_VAR = 'GEMINI_MODEL_ID' as const;
export const DEFAULT_GEMINI_VISION_MODEL_ID = 'gemini-4-hydrogen' as const;

const PLACEHOLDER_KEY_VALUES = new Set([
  'my_gemini_api_key',
  'your_gemini_api_key',
  'gemini_api_key',
  'placeholder',
  'changeme',
  'replace_me',
]);

const DEPRECATED_MODEL_IDS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-pro-vision',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

const MODEL_ID_PATTERN = /^(models\/)?[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/;

export type GeminiEnvSource = Readonly<Record<string, string | undefined>>;

export interface GeminiPublicConfiguration {
  readonly providerId: typeof GEMINI_PROVIDER_ID;
  readonly providerName: typeof GEMINI_PROVIDER_NAME;
  readonly credentialEnvVar: typeof GEMINI_API_KEY_ENV_VAR;
  readonly modelEnvVar: typeof GEMINI_MODEL_ID_ENV_VAR;
  readonly credentialConfigured: boolean;
  readonly modelConfigured: boolean;
  readonly modelId: string | null;
  readonly errorCategory?: GeminiErrorCategory;
  readonly configurationMessage: string;
  readonly setupInstruction?: string;
}

export function normalizeModelIdentifier(rawModelId: string): string {
  const trimmed = rawModelId.trim();
  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
}

export function isUsableCredentialValue(rawKey: string | undefined): boolean {
  if (typeof rawKey !== 'string') {
    return false;
  }
  const trimmed = rawKey.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return !PLACEHOLDER_KEY_VALUES.has(trimmed.toLowerCase());
}

export function validateConfiguredModelId(rawModelEnv: string | undefined): {
  readonly valid: boolean;
  readonly modelId: string | null;
  readonly errorCategory?: GeminiErrorCategory;
  readonly message: string;
} {
  if (rawModelEnv === undefined) {
    return {
      valid: true,
      modelId: DEFAULT_GEMINI_VISION_MODEL_ID,
      message: `Using default server-configured model "${DEFAULT_GEMINI_VISION_MODEL_ID}".`,
    };
  }

  const trimmed = rawModelEnv.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      modelId: null,
      errorCategory: 'INVALID_MODEL_CONFIGURATION',
      message: `${GEMINI_MODEL_ID_ENV_VAR} is set to an empty value. Provide a valid Gemini model identifier.`,
    };
  }

  if (!MODEL_ID_PATTERN.test(trimmed)) {
    return {
      valid: false,
      modelId: null,
      errorCategory: 'INVALID_MODEL_CONFIGURATION',
      message: `${GEMINI_MODEL_ID_ENV_VAR} contains an invalid model identifier format.`,
    };
  }

  const normalized = normalizeModelIdentifier(trimmed);
  if (DEPRECATED_MODEL_IDS.has(normalized.toLowerCase())) {
    return {
      valid: false,
      modelId: null,
      errorCategory: 'INVALID_MODEL_CONFIGURATION',
      message: `Configured ${GEMINI_MODEL_ID_ENV_VAR} references a deprecated Gemini model. Update it to an active model such as "${DEFAULT_GEMINI_VISION_MODEL_ID}".`,
    };
  }

  return {
    valid: true,
    modelId: normalized,
    message: `Using server-configured model "${normalized}".`,
  };
}

export function resolveGeminiPublicConfiguration(
  env: GeminiEnvSource = process.env,
): GeminiPublicConfiguration {
  const credentialConfigured = isUsableCredentialValue(env[GEMINI_API_KEY_ENV_VAR]);
  const modelValidation = validateConfiguredModelId(env[GEMINI_MODEL_ID_ENV_VAR]);

  if (!credentialConfigured && !modelValidation.valid) {
    return {
      providerId: GEMINI_PROVIDER_ID,
      providerName: GEMINI_PROVIDER_NAME,
      credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
      modelEnvVar: GEMINI_MODEL_ID_ENV_VAR,
      credentialConfigured: false,
      modelConfigured: false,
      modelId: null,
      errorCategory: 'INVALID_CONFIGURATION',
      configurationMessage:
        'Server Gemini API key is missing and the configured model identifier is invalid.',
      setupInstruction:
        'Configure GEMINI_API_KEY in AI Studio Settings > Secrets (or your server environment) and verify GEMINI_MODEL_ID.',
    };
  }

  if (!credentialConfigured) {
    return {
      providerId: GEMINI_PROVIDER_ID,
      providerName: GEMINI_PROVIDER_NAME,
      credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
      modelEnvVar: GEMINI_MODEL_ID_ENV_VAR,
      credentialConfigured: false,
      modelConfigured: modelValidation.valid,
      modelId: modelValidation.modelId,
      errorCategory: 'MISSING_CREDENTIAL',
      configurationMessage:
        'GEMINI_API_KEY is not configured in the server runtime environment.',
      setupInstruction:
        'Set GEMINI_API_KEY in AI Studio Settings > Secrets (or the server environment) to enable Gemini Vision.',
    };
  }

  if (!modelValidation.valid) {
    return {
      providerId: GEMINI_PROVIDER_ID,
      providerName: GEMINI_PROVIDER_NAME,
      credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
      modelEnvVar: GEMINI_MODEL_ID_ENV_VAR,
      credentialConfigured: true,
      modelConfigured: false,
      modelId: null,
      errorCategory: modelValidation.errorCategory ?? 'INVALID_MODEL_CONFIGURATION',
      configurationMessage: modelValidation.message,
      setupInstruction: `Set ${GEMINI_MODEL_ID_ENV_VAR} to a valid Gemini model ID such as "${DEFAULT_GEMINI_VISION_MODEL_ID}".`,
    };
  }

  return {
    providerId: GEMINI_PROVIDER_ID,
    providerName: GEMINI_PROVIDER_NAME,
    credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
    modelEnvVar: GEMINI_MODEL_ID_ENV_VAR,
    credentialConfigured: true,
    modelConfigured: true,
    modelId: modelValidation.modelId,
    configurationMessage: modelValidation.message,
  };
}

/**
 * Internal server-only credential resolver. Never pass the returned string
 * outside server/providers/gemini/ or serialize it into responses or errors.
 */
export function resolveGeminiServerCredential(
  env: GeminiEnvSource = process.env,
): string | null {
  const raw = env[GEMINI_API_KEY_ENV_VAR];
  if (!isUsableCredentialValue(raw) || typeof raw !== 'string') {
    return null;
  }
  return raw.trim();
}
