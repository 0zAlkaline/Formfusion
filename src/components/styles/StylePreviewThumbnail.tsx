import type { ArtStyle, StylePreviewMotif } from '../../types/domain.ts';
import { cn } from '../ui/index.ts';

interface StylePreviewThumbnailProps {
  readonly style: ArtStyle;
  readonly className?: string;
  readonly compact?: boolean;
}

const DEFAULT_PALETTE: readonly [string, string, string, string] = [
  '#F3F0E8',
  '#315BDE',
  '#D4623F',
  '#17191E',
];

function renderMotifShapes(
  motif: StylePreviewMotif,
  palette: readonly [string, string, string, string],
) {
  const [bg, primary, secondary, ink] = palette;

  switch (motif) {
    case 'editorial_arch':
      return (
        <>
          <rect width="320" height="200" fill={bg} />
          <path d="M40 200 V92 A70 70 0 0 1 180 92 V200 Z" fill={secondary} opacity="0.9" />
          <circle cx="222" cy="76" r="36" fill={primary} />
          <rect x="172" y="122" width="108" height="78" fill={ink} opacity="0.88" />
          <path d="M84 148 Q128 106 164 146" stroke={bg} strokeWidth="3" fill="none" />
        </>
      );

    case 'anime_horizon':
      return (
        <>
          <defs>
            <linearGradient id="ff-anime-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary} stopOpacity="0.85" />
              <stop offset="65%" stopColor={bg} />
              <stop offset="100%" stopColor={secondary} stopOpacity="0.65" />
            </linearGradient>
          </defs>
          <rect width="320" height="200" fill="url(#ff-anime-sky)" />
          <circle cx="236" cy="54" r="24" fill={secondary} opacity="0.92" />
          <path d="M0 152 Q82 118 164 142 T320 132 V200 H0 Z" fill={ink} opacity="0.72" />
          <path d="M0 168 Q110 144 218 164 T320 158 V200 H0 Z" fill={ink} opacity="0.9" />
          <ellipse cx="92" cy="64" rx="46" ry="14" fill="#FFFFFF" opacity="0.75" />
          <ellipse cx="122" cy="56" rx="28" ry="11" fill="#FFFFFF" opacity="0.85" />
        </>
      );

    case 'geometric_study':
      return (
        <>
          <rect width="320" height="200" fill={bg} />
          <circle cx="112" cy="100" r="64" fill={primary} opacity="0.9" />
          <rect x="144" y="42" width="114" height="114" fill={secondary} opacity="0.88" />
          <polygon points="112,36 176,164 48,164" fill={ink} opacity="0.82" />
          <circle cx="201" cy="99" r="24" fill={bg} />
        </>
      );

    case 'psychedelic_wave':
      return (
        <>
          <rect width="320" height="200" fill={bg} />
          <path d="M0 64 Q80 18 160 64 T320 64 V200 H0 Z" fill={secondary} opacity="0.88" />
          <path d="M0 102 Q80 56 160 102 T320 102 V200 H0 Z" fill={ink} opacity="0.65" />
          <path d="M0 140 Q80 94 160 140 T320 140 V200 H0 Z" fill={primary} opacity="0.92" />
          <circle cx="242" cy="52" r="26" fill={primary} opacity="0.9" />
        </>
      );

    case 'monoline_vessel':
      return (
        <>
          <rect width="320" height="200" fill={bg} />
          <g fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="44" y="28" width="232" height="144" rx="4" stroke={ink} strokeOpacity="0.18" strokeWidth="1.2" />
            <ellipse cx="160" cy="62" rx="40" ry="12" />
            <path d="M120 62 C110 92 98 118 114 148 C126 168 194 168 206 148 C222 118 210 92 200 62" />
            <path d="M204 82 C232 82 232 126 206 128" />
            <line x1="76" y1="166" x2="244" y2="166" />
          </g>
          <circle cx="246" cy="48" r="7" fill={primary} />
        </>
      );

    case 'matisse_foliage':
      return (
        <>
          <rect width="320" height="200" fill={bg} />
          <path d="M64 180 C52 124 72 70 112 36 C116 86 104 134 94 180 Z" fill={primary} />
          <path d="M138 182 C136 130 162 82 214 54 C202 104 184 144 166 182 Z" fill={secondary} />
          <path d="M208 176 C224 134 252 108 286 96 C272 138 248 164 224 180 Z" fill={ink} />
          <circle cx="118" cy="116" r="18" fill={secondary} opacity="0.9" />
        </>
      );

    case 'bauhaus_grid':
      return (
        <>
          <rect width="320" height="200" fill={bg} />
          <line x1="0" y1="142" x2="320" y2="142" stroke="#17191E" strokeWidth="4" />
          <line x1="112" y1="0" x2="112" y2="200" stroke="#17191E" strokeWidth="4" />
          <circle cx="182" cy="94" r="50" fill={primary} />
          <polygon points="112,38 228,142 112,142" fill={secondary} opacity="0.88" />
          <rect x="216" y="42" width="60" height="60" fill={ink} />
        </>
      );

    case 'engraving_crosshatch':
      return (
        <>
          <rect width="320" height="200" fill={bg} />
          <g stroke={ink} strokeWidth="1.2" opacity="0.72">
            {Array.from({ length: 18 }).map((_, i) => (
              <line key={`h-${i}`} x1={48 + i * 12} y1="26" x2={26 + i * 12} y2="174" />
            ))}
            {Array.from({ length: 12 }).map((_, i) => (
              <line key={`c-${i}`} x1="74" y1={42 + i * 10} x2="246" y2={58 + i * 10} strokeOpacity="0.45" />
            ))}
          </g>
          <circle cx="160" cy="100" r="46" fill={bg} stroke={ink} strokeWidth="2.5" />
          <path d="M132 100 A28 28 0 0 1 188 100" fill="none" stroke={ink} strokeWidth="2" />
          <path d="M124 114 Q160 132 196 114" fill="none" stroke={ink} strokeWidth="1.6" />
        </>
      );

    case 'watercolor_wash':
      return (
        <>
          <rect width="320" height="200" fill={bg} />
          <circle cx="116" cy="96" r="64" fill={primary} opacity="0.42" />
          <circle cx="186" cy="112" r="58" fill={secondary} opacity="0.48" />
          <ellipse cx="158" cy="76" rx="74" ry="38" fill={ink} opacity="0.34" />
          <path d="M74 148 Q154 118 242 146" fill="none" stroke="#4D4238" strokeWidth="1.5" strokeOpacity="0.65" />
        </>
      );

    case 'clay_sculpture':
      return (
        <>
          <defs>
            <radialGradient id="ff-clay-sphere" cx="38%" cy="32%" r="65%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.65" />
              <stop offset="55%" stopColor={primary} />
              <stop offset="100%" stopColor="#8F462D" />
            </radialGradient>
          </defs>
          <rect width="320" height="200" fill={bg} />
          <ellipse cx="160" cy="162" rx="84" ry="14" fill={ink} opacity="0.22" />
          <rect x="86" y="88" width="96" height="66" rx="28" fill={secondary} />
          <circle cx="192" cy="94" r="48" fill="url(#ff-clay-sphere)" />
        </>
      );

    case 'chrome_prism':
      return (
        <>
          <defs>
            <linearGradient id="ff-chrome-bar" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={primary} />
              <stop offset="45%" stopColor={ink} />
              <stop offset="72%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor={secondary} />
            </linearGradient>
          </defs>
          <rect width="320" height="200" fill={bg} />
          <polygon points="160,26 244,100 160,174 76,100" fill="url(#ff-chrome-bar)" />
          <line x1="36" y1="100" x2="284" y2="100" stroke={secondary} strokeWidth="1.5" strokeOpacity="0.65" />
          <circle cx="160" cy="100" r="24" fill={bg} stroke={primary} strokeWidth="2" />
        </>
      );

    case 'gothic_rosette':
      return (
        <>
          <rect width="320" height="200" fill={bg} />
          <g fill="none" stroke={primary} strokeWidth="2">
            <path d="M88 186 V96 C88 58 124 30 160 22 C196 30 232 58 232 96 V186" />
            <circle cx="160" cy="98" r="42" />
            <circle cx="160" cy="98" r="20" stroke={ink} strokeOpacity="0.8" />
            <polygon points="160,56 196,120 124,120" strokeOpacity="0.7" />
            <polygon points="160,140 196,76 124,76" stroke={secondary} strokeOpacity="0.85" />
          </g>
        </>
      );
  }
}

export function StylePreviewThumbnail({
  style,
  className,
  compact = false,
}: StylePreviewThumbnailProps) {
  const preview = style.previewAsset;
  const motif: StylePreviewMotif = preview?.motif ?? 'editorial_arch';
  const palette = preview?.palette ?? DEFAULT_PALETTE;

  return (
    <div
      className={cn(
        'relative overflow-hidden border-b border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)]',
        compact ? 'aspect-[16/9]' : 'aspect-[16/10]',
        className,
      )}
    >
      <svg
        viewBox="0 0 320 200"
        role="img"
        aria-label={`${style.name} curated style visual motif`}
        className="h-full w-full object-cover block"
      >
        {renderMotifShapes(motif, palette)}
      </svg>

      <div className="pointer-events-none absolute inset-x-3 bottom-2.5 flex items-center justify-between gap-2">
        <span className="rounded-[var(--ff-radius-sm)] bg-[#17191E]/75 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
          Style Reference
        </span>
        <div className="flex items-center gap-1" aria-hidden="true">
          {palette.map((hex, index) => (
            <span
              key={`${style.id}-swatch-${index}`}
              className="h-3 w-3 rounded-full border border-white/80"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
