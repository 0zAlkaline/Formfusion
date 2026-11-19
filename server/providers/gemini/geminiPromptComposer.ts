import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createHash } from 'node:crypto';
import type {
  PromptSynthesisProviderInput,
  PromptSynthesisProviderOutput,
} from '../../../src/types/providers.ts';
import { sanitizeDiagnosticMessage } from '../../middleware/security.ts';
import {
  DEFAULT_GEMINI_VISION_MODEL_ID,
  resolveGeminiPublicConfiguration,
  resolveGeminiServerCredential,
  type GeminiEnvSource,
} from './config.ts';
import {
  GeminiConfigurationError,
  GeminiResponseError,
  GeminiSdkInitializationError,
  mapGeminiProviderError,
  type MappedGeminiProviderError,
} from './errorMapper.ts';
import type { GeminiGenerateContentResponseLike } from './geminiVisionProvider.ts';

export const GEMINI_PROMPT_COMPOSER_SYSTEM_INSTRUCTION = `You are a senior creative director and visual prompt architect for FormFusion, a non-destructive AI creative studio.

Your task is to synthesize a single, coherent, detailed Master Prompt and an optional grounded Negative Prompt from structured studio inputs:
1. Editable Object Description (authoritative subject identity)
2. Structured Art Style / Creative Direction
3. Composition and Output Preferences
4. User Creative Instructions
5. Any detected potential input conflicts

STRICT SYNTHESIS RULES:

SUBJECT PRESERVATION:
- Treat the Editable Object Description as the absolute authoritative source of subject identity.
- Preserve the subject's defining silhouette, proportions, materials, colors, surface details, distinctive features, and preservation priorities.
- Never invent physical attributes that are missing or unconfirmed.
- Treat attributes listed under "Uncertain / Ambiguous Attributes" strictly as uncertain: never fabricate certainty or fill in unseen features.

STYLE INTEGRATION:
- Translate the active style rules (rendering, linework, color treatment, texture, shading, visual characteristics) into concrete, harmonious visual direction.
- Reconcile style rules with the subject's physical characteristics cleanly so style transformation enhances rather than erases subject identity.
- Maintain internal consistency across linework, color, texture, shading, and rendering.

COMPOSITION & OUTPUT PREFERENCES:
- Respect the subject's viewing angle and composition unless explicit user instructions request a transformation.
- Incorporate the specified aspect ratio, output orientation, background treatment, and detail level naturally as visual prose (never provider-specific syntax).
- Do not introduce unrelated objects, extra props, or unrequested environmental clutter.

CONFLICT RESOLUTION:
- Compare all inputs for contradictions (for example: photorealism vs. flat 2D illustration, monochrome vs. vibrant multi-color, clean isolated backdrop vs. busy scene, or conflicting aspect/framing requests).
- Prioritize explicit user instructions when compatible with subject preservation priorities.
- Preserve essential subject identity and core style consistency without silently inventing contradictory compromises.
- Whenever any ambiguity or conflict cannot be cleanly resolved without user clarification, list each unresolved conflict concisely in "unresolvedConflicts". If there are no unresolved conflicts, return an empty array [].

PROMPT QUALITY:
- Write "generatedPrompt" as clear, vivid, natural-language editorial/studio visual direction suitable for any modern text-to-image model.
- Be specific rather than generic, avoid fluff or buzzword lists, and avoid unnecessary repetition.
- NEVER emit provider-specific flags or syntax (such as --ar, --v, --style, --no, weights like (word:1.2), or <lora:...>).
- NEVER emit base64 strings or image URLs.

NEGATIVE PROMPT GROUNDING:
- Populate "negativePrompt" ONLY with exclusions directly supported by the style's negative directives/template OR explicit exclusions stated in the user's creative instructions (such as "avoid...", "no...", "without...", "exclude...").
- If neither the style configuration nor user instructions support any negative directives, return "" (an empty string) for "negativePrompt". Do not invent generic quality spam.

Return valid JSON matching the requested schema.`;

export interface GeminiPromptGenerateContentParams {
  model: string;
  contents: string;
  config?: {
    systemInstruction?: string;
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
    abortSignal?: AbortSignal;
    httpOptions?: {
      timeout?: number;
      headers?: Record<string, string>;
    };
    thinkingConfig?: {
      thinkingLevel?: ThinkingLevel;
    };
  };
}

export interface GeminiPromptSdkClient {
  readonly models: {
    generateContent(
      params: GeminiPromptGenerateContentParams,
    ): Promise<GeminiGenerateContentResponseLike>;
  };
}

export type GeminiPromptSdkClientFactory = (apiKey: string) => GeminiPromptSdkClient;

export interface GeminiPromptComposerOptions {
  readonly getEnv?: () => GeminiEnvSource;
  readonly createSdkClient?: GeminiPromptSdkClientFactory;
  readonly defaultSynthesisTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
}

export interface GeminiPromptSynthesisExecutionResult {
  readonly result?: PromptSynthesisProviderOutput;
  readonly mappedError?: MappedGeminiProviderError;
  readonly cancelled?: boolean;
}

const DEFAULT_SYNTHESIS_TIMEOUT_MS = 45000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 600;
const GEMINI_TELEMETRY_HEADERS = {
  'User-Agent': 'aistudio-build',
} as const;

function sleepWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createDefaultGeminiPromptSdkClient(
  apiKey: string,
): GeminiPromptSdkClient {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        ...GEMINI_TELEMETRY_HEADERS,
      },
    },
  });
}

function fingerprintConfig(
  credential: string | null,
  modelId: string | null,
): string {
  const keyHash = credential
    ? createHash('sha256').update(credential).digest('hex').slice(0, 12)
    : 'none';
  return `${keyHash}:${modelId ?? 'none'}`;
}

export function buildGeminiSynthesisUserPrompt(
  input: PromptSynthesisProviderInput,
): string {
  const { subject, creativeDirection, compositionPreferences } = input;
  const lines: string[] = [
    '=== AUTHORITATIVE EDITABLE OBJECT DESCRIPTION ===',
    `Description Revision: v${subject.sourceDescriptionRevision}`,
    `Object Name: ${subject.objectName}`,
    `Object Category: ${subject.objectCategory}`,
    `Primary Description: ${subject.primaryDescription}`,
    `Shape & Silhouette: ${subject.shapeAndSilhouette || 'Not specified'}`,
    `Materials: ${subject.materials.length > 0 ? subject.materials.join(', ') : 'Not specified'}`,
    `Dominant Colors: ${subject.dominantColors.length > 0 ? subject.dominantColors.join(', ') : 'Not specified'}`,
    `Surface Details: ${subject.surfaceDetails || 'Not specified'}`,
    `Distinctive Features: ${subject.distinctiveFeatures.length > 0 ? subject.distinctiveFeatures.join('; ') : 'Not specified'}`,
    `Subject Composition: ${subject.composition || 'Not specified'}`,
    `Viewing Angle: ${subject.viewingAngle || 'Not specified'}`,
    `Preservation Priorities: ${subject.preservationPriorities.length > 0 ? subject.preservationPriorities.join('; ') : 'Preserve core subject identity and proportions'}`,
    `Uncertain / Ambiguous Attributes (DO NOT FABRICATE): ${subject.uncertainAttributes.length > 0 ? subject.uncertainAttributes.join('; ') : 'None noted'}`,
    `Studio Notes: ${subject.userNotes || 'None'}`,
    '',
    '=== ART STYLE & CREATIVE DIRECTION ===',
    `Mode: ${creativeDirection.isManualCreativeDirection ? 'Manual Creative Direction' : 'Selected Style Library Entry'}`,
    `Style Name: ${creativeDirection.styleName}`,
    `Style Category: ${creativeDirection.styleCategory}`,
    `Style Description: ${creativeDirection.styleDescription || 'Not specified'}`,
    `Visual Characteristics: ${creativeDirection.visualCharacteristics || 'Not specified'}`,
    `Rendering Rules: ${creativeDirection.renderingRules || creativeDirection.renderingTechnique || 'Not specified'}`,
    `Linework Rules: ${creativeDirection.lineworkRules || 'Not specified'}`,
    `Color Rules: ${creativeDirection.colorRules || 'Not specified'}`,
    `Texture Rules: ${creativeDirection.textureRules || 'Not specified'}`,
    `Shading Rules: ${creativeDirection.shadingRules || 'Not specified'}`,
    `Style Composition Rules: ${creativeDirection.compositionRules || 'Not specified'}`,
    `Style Detail Level: ${creativeDirection.detailLevel}`,
    `Style Prompt Template: ${creativeDirection.promptTemplate || 'None'}`,
    `Style Negative Directives: ${creativeDirection.negativePromptTemplate || 'None'}`,
    '',
    '=== COMPOSITION & OUTPUT PREFERENCES ===',
    `Aspect Ratio: ${compositionPreferences.aspectRatio}`,
    `Output Orientation: ${compositionPreferences.outputOrientation}`,
    `Composition Direction: ${compositionPreferences.compositionDirection}`,
    `Background Treatment: ${compositionPreferences.backgroundTreatment}`,
    `Detail Level: ${compositionPreferences.detailLevel}`,
    '',
    '=== USER CREATIVE INSTRUCTIONS ===',
    input.creativeInstructions.trim() || 'No additional user creative instructions provided.',
  ];

  if (input.detectedInputConflicts && input.detectedInputConflicts.length > 0) {
    lines.push(
      '',
      '=== PRE-DETECTED POTENTIAL CONFLICTS TO EVALUATE ===',
      ...input.detectedInputConflicts.map((c, idx) => `${idx + 1}. ${c}`),
    );
  }

  return lines.join('\n');
}

function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseGeminiSynthesisResponseText(rawText: string): {
  readonly generatedPrompt: string;
  readonly negativePrompt: string;
  readonly unresolvedConflicts: readonly string[];
} {
  const cleaned = stripJsonCodeFences(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new GeminiResponseError(
      'INVALID_RESPONSE',
      'Gemini Prompt Composer returned malformed JSON that could not be parsed.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GeminiResponseError(
      'INVALID_RESPONSE',
      'Gemini Prompt Composer response must be a JSON object.',
    );
  }

  const record = parsed as Record<string, unknown>;
  const generatedPrompt =
    typeof record.generatedPrompt === 'string'
      ? record.generatedPrompt.trim()
      : '';

  if (generatedPrompt.length === 0) {
    throw new GeminiResponseError(
      'EMPTY_RESPONSE',
      'Gemini returned an empty Master Prompt. Review your inputs and try composing again.',
    );
  }

  const negativePrompt =
    typeof record.negativePrompt === 'string'
      ? record.negativePrompt.trim()
      : '';

  const unresolvedConflicts = Array.isArray(record.unresolvedConflicts)
    ? record.unresolvedConflicts
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];

  return {
    generatedPrompt,
    negativePrompt,
    unresolvedConflicts,
  };
}

export class GeminiPromptComposerProvider {
  private readonly getEnv: () => GeminiEnvSource;
  private readonly createSdkClient: GeminiPromptSdkClientFactory;
  private readonly defaultSynthesisTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  private cachedFingerprint: string | null = null;
  private cachedClient: GeminiPromptSdkClient | null = null;
  private cachedInitError: MappedGeminiProviderError | null = null;

  constructor(options: GeminiPromptComposerOptions = {}) {
    this.getEnv = options.getEnv ?? (() => process.env);
    this.createSdkClient =
      options.createSdkClient ?? createDefaultGeminiPromptSdkClient;
    this.defaultSynthesisTimeoutMs =
      options.defaultSynthesisTimeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryBaseDelayMs = Math.max(
      0,
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    );
  }

  async synthesizeMasterPrompt(
    input: PromptSynthesisProviderInput,
  ): Promise<GeminiPromptSynthesisExecutionResult> {
    const env = this.getEnv();
    const publicConfig = resolveGeminiPublicConfiguration(env);
    const credential = resolveGeminiServerCredential(env);
    this.syncFingerprint(credential, publicConfig.modelId);

    if (!publicConfig.credentialConfigured) {
      return {
        mappedError: mapGeminiProviderError(
          new GeminiConfigurationError(
            publicConfig.errorCategory ?? 'MISSING_CREDENTIAL',
            publicConfig.configurationMessage,
          ),
        ),
      };
    }

    if (!publicConfig.modelConfigured || !publicConfig.modelId) {
      return {
        mappedError: mapGeminiProviderError(
          new GeminiConfigurationError(
            publicConfig.errorCategory ?? 'INVALID_MODEL_CONFIGURATION',
            publicConfig.configurationMessage,
          ),
          credential ? [credential] : [],
        ),
      };
    }

    const clientResult = this.ensureClientInitialized(
      credential,
      publicConfig.modelId,
    );
    if (!clientResult.ok) {
      return { mappedError: clientResult.mappedError };
    }

    if (input.abortSignal?.aborted) {
      return { cancelled: true };
    }

    const timeoutMs = input.timeoutMs ?? this.defaultSynthesisTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    let clientCancelled = false;

    const onExternalAbort = () => {
      clientCancelled = true;
      controller.abort(
        input.abortSignal?.reason ??
          new Error('Client aborted prompt synthesis request.'),
      );
    };

    if (input.abortSignal) {
      input.abortSignal.addEventListener('abort', onExternalAbort, {
        once: true,
      });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new Error(`Gemini prompt synthesis timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    const startedAt = Date.now();
    const deadlineAt = startedAt + timeoutMs;

    try {
      const activeModel =
        publicConfig.modelId ?? DEFAULT_GEMINI_VISION_MODEL_ID;
      const supportsThinkingLevel = /^gemini-(3|4)/i.test(activeModel);
      const userPrompt = buildGeminiSynthesisUserPrompt(input);
      const totalAttempts = 1 + this.maxRetries;

      for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
        if (clientCancelled && !timedOut) {
          return { cancelled: true };
        }

        const remainingBudgetMs = Math.max(1000, deadlineAt - Date.now());
        const perAttemptCapMs =
          this.maxRetries > 0 && timeoutMs >= 40000
            ? Math.min(remainingBudgetMs, 16000)
            : remainingBudgetMs;

        const attemptController = new AbortController();
        const forwardAbort = () => {
          attemptController.abort(controller.signal.reason);
        };
        if (controller.signal.aborted) {
          forwardAbort();
        } else {
          controller.signal.addEventListener('abort', forwardAbort, {
            once: true,
          });
        }
        const attemptTimer =
          perAttemptCapMs < remainingBudgetMs
            ? setTimeout(() => {
                attemptController.abort(
                  new Error(
                    `Gemini prompt synthesis attempt ${attempt + 1} timed out after ${perAttemptCapMs}ms`,
                  ),
                );
              }, perAttemptCapMs)
            : undefined;

        try {
          const response = await clientResult.client.models.generateContent({
            model: activeModel,
            contents: userPrompt,
            config: {
              systemInstruction: GEMINI_PROMPT_COMPOSER_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  generatedPrompt: {
                    type: Type.STRING,
                    description:
                      'Complete, coherent, provider-independent Master Prompt synthesized in natural language.',
                  },
                  negativePrompt: {
                    type: Type.STRING,
                    description:
                      'Negative directives grounded strictly in active style rules or explicit user instructions, or empty string if none.',
                  },
                  unresolvedConflicts: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description:
                      'Concise list of unresolved contradictions requiring user clarification, or empty array.',
                  },
                },
                required: ['generatedPrompt', 'negativePrompt', 'unresolvedConflicts'],
              },
              abortSignal: attemptController.signal,
              httpOptions: {
                timeout: attempt === 0 ? timeoutMs : remainingBudgetMs,
                headers: { ...GEMINI_TELEMETRY_HEADERS },
              },
              ...(supportsThinkingLevel
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
            },
          });

          if (!response || typeof response !== 'object') {
            throw new GeminiResponseError(
              'INVALID_RESPONSE',
              'Gemini returned an invalid or unrecognized prompt synthesis response.',
            );
          }

          if (response.promptFeedback?.blockReason) {
            throw new GeminiResponseError(
              'BLOCKED_RESPONSE',
              response.promptFeedback.blockReasonMessage ??
                `Gemini declined to synthesize the prompt (${response.promptFeedback.blockReason}).`,
            );
          }

          const rawText = typeof response.text === 'string' ? response.text.trim() : '';
          if (!rawText) {
            throw new GeminiResponseError(
              'EMPTY_RESPONSE',
              'Gemini returned an empty response during prompt synthesis. Try again.',
            );
          }

          const parsed = parseGeminiSynthesisResponseText(rawText);
          const finishReason =
            typeof response.candidates?.[0]?.finishReason === 'string'
              ? response.candidates[0].finishReason
              : undefined;

          return {
            result: {
              requestStatus: 'succeeded',
              providerId: 'gemini',
              modelId: activeModel,
              ...(typeof response.modelVersion === 'string' &&
              response.modelVersion.trim().length > 0
                ? { modelVersion: response.modelVersion.trim() }
                : {}),
              ...(typeof response.responseId === 'string' &&
              response.responseId.trim().length > 0
                ? { responseId: response.responseId.trim() }
                : {}),
              generatedAt: new Date().toISOString(),
              generatedPrompt: parsed.generatedPrompt,
              negativePrompt: parsed.negativePrompt,
              unresolvedConflicts: parsed.unresolvedConflicts,
              ...(finishReason ? { finishReason } : {}),
            },
          };
        } catch (attemptError: unknown) {
          if (clientCancelled && !timedOut) {
            return { cancelled: true };
          }

          const mapped = mapGeminiProviderError(
            attemptError,
            credential ? [credential] : [],
          );

          const jitterMs =
            this.retryBaseDelayMs > 0 ? Math.floor(Math.random() * 120) : 0;
          const backoffMs =
            this.retryBaseDelayMs > 0
              ? Math.min(4000, this.retryBaseDelayMs * 2 ** attempt) + jitterMs
              : 0;
          const hasNextAttempt = attempt + 1 < totalAttempts;
          const minRemainingForRetryMs = timeoutMs >= 10000 ? 11500 : 500;
          const hasBudgetForRetry =
            Date.now() + backoffMs + minRemainingForRetryMs <= deadlineAt;

          if (
            !timedOut &&
            !controller.signal.aborted &&
            mapped.retryable &&
            hasNextAttempt &&
            hasBudgetForRetry
          ) {
            const detailSuffix = mapped.diagnosticDetail
              ? ` (${mapped.diagnosticDetail})`
              : '';
            console.warn(
              '[FormFusion Gemini Prompt Composer]',
              sanitizeDiagnosticMessage(
                `Transient prompt synthesis failure on attempt ${attempt + 1}/${totalAttempts} (${mapped.category}, status=${mapped.upstreamStatus ?? 'n/a'}) for project=${input.projectId}${detailSuffix}; retrying in ${backoffMs}ms.`,
                credential ? [credential] : [],
              ),
            );
            await sleepWithAbort(backoffMs, controller.signal);
            continue;
          }

          throw mapped;
        } finally {
          if (attemptTimer !== undefined) {
            clearTimeout(attemptTimer);
          }
          controller.signal.removeEventListener('abort', forwardAbort);
        }
      }

      throw mapGeminiProviderError(
        new Error('Gemini prompt synthesis exhausted all retry attempts.'),
        credential ? [credential] : [],
      );
    } catch (error: unknown) {
      if (clientCancelled && !timedOut) {
        return { cancelled: true };
      }

      const mapped =
        typeof error === 'object' &&
        error !== null &&
        'category' in error &&
        'httpStatus' in error &&
        'normalized' in error
          ? (error as MappedGeminiProviderError)
          : mapGeminiProviderError(error, credential ? [credential] : []);

      const detailSuffix = mapped.diagnosticDetail
        ? ` | detail: ${mapped.diagnosticDetail}`
        : '';
      console.error(
        '[FormFusion Gemini Prompt Composer]',
        sanitizeDiagnosticMessage(
          `Prompt synthesis failed (${mapped.category}, status=${mapped.upstreamStatus ?? 'n/a'}) for project=${input.projectId}: ${mapped.message}${detailSuffix}`,
          credential ? [credential] : [],
        ),
      );
      return { mappedError: mapped };
    } finally {
      clearTimeout(timer);
      if (input.abortSignal) {
        input.abortSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  private syncFingerprint(
    credential: string | null,
    modelId: string | null,
  ): void {
    const nextFingerprint = fingerprintConfig(credential, modelId);
    if (this.cachedFingerprint !== nextFingerprint) {
      this.cachedFingerprint = nextFingerprint;
      this.cachedClient = null;
      this.cachedInitError = null;
    }
  }

  private ensureClientInitialized(
    credential: string | null,
    modelId: string | null,
  ):
    | { readonly ok: true; readonly client: GeminiPromptSdkClient }
    | { readonly ok: false; readonly mappedError: MappedGeminiProviderError } {
    if (!credential) {
      return {
        ok: false,
        mappedError: mapGeminiProviderError(
          new GeminiConfigurationError(
            'MISSING_CREDENTIAL',
            'GEMINI_API_KEY is not configured in the server runtime environment.',
          ),
        ),
      };
    }
    if (!modelId) {
      return {
        ok: false,
        mappedError: mapGeminiProviderError(
          new GeminiConfigurationError(
            'INVALID_MODEL_CONFIGURATION',
            'GEMINI_MODEL_ID is missing or invalid.',
          ),
          [credential],
        ),
      };
    }

    if (this.cachedClient) {
      return { ok: true, client: this.cachedClient };
    }
    if (this.cachedInitError) {
      return { ok: false, mappedError: this.cachedInitError };
    }

    try {
      const client = this.createSdkClient(credential);
      if (
        !client ||
        typeof client !== 'object' ||
        !client.models ||
        typeof client.models.generateContent !== 'function'
      ) {
        throw new GeminiSdkInitializationError(
          'Gemini SDK client did not expose models.generateContent.',
        );
      }
      this.cachedClient = client;
      return { ok: true, client };
    } catch (error: unknown) {
      const wrapped =
        error instanceof GeminiSdkInitializationError
          ? error
          : new GeminiSdkInitializationError(
              sanitizeDiagnosticMessage(
                error instanceof Error ? error.message : String(error),
                [credential],
              ) || 'Failed to instantiate Gemini SDK client.',
            );
      const mapped = mapGeminiProviderError(wrapped, [credential]);
      this.cachedInitError = mapped;
      return { ok: false, mappedError: mapped };
    }
  }
}

export function createGeminiPromptComposerProvider(
  options?: GeminiPromptComposerOptions,
): GeminiPromptComposerProvider {
  return new GeminiPromptComposerProvider(options);
}
