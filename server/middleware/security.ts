import type { NextFunction, Request, Response } from 'express';

const SECRET_PATTERNS: readonly RegExp[] = [
  /AIza[0-9A-Za-z_-]{16,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /(Bearer\s+)[A-Za-z0-9._-]+/gi,
  /(x-goog-api-key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
  /(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
  /(secret["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
];

export function redactSecretValues(
  input: string,
  extraSecrets: readonly (string | undefined)[] = [],
): string {
  let sanitized = input;

  const activeSecrets = [
    process.env.GEMINI_API_KEY,
    process.env.OVH_AI_ENDPOINTS_ACCESS_TOKEN,
    ...extraSecrets,
  ];

  for (const secret of activeSecrets) {
    if (
      typeof secret === 'string' &&
      secret.trim().length >= 8 &&
      secret.trim() !== 'MY_GEMINI_API_KEY' &&
      secret.trim() !== 'MY_OVH_AI_ENDPOINTS_ACCESS_TOKEN'
    ) {
      sanitized = sanitized.split(secret.trim()).join('[REDACTED]');
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (_match, prefix?: string) =>
      prefix ? `${prefix}[REDACTED]` : '[REDACTED]',
    );
  }
  return sanitized;
}

export function sanitizeDiagnosticMessage(
  input: string,
  extraSecrets: readonly (string | undefined)[] = [],
): string {
  const firstLine = input.split(/\r?\n/)[0]?.trim() ?? '';
  return redactSecretValues(firstLine, extraSecrets);
}

export function setSecurityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

export function requireJsonBody(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      res.status(415).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Content-Type must be application/json.',
        },
      });
      return;
    }
  }
  next();
}
