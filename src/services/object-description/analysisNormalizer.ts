import type { DetectedObjectItem, ObjectAnalysis } from '../../types/domain.ts';
import type { RawVisionAnalysisResult } from '../../types/providers.ts';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids.ts';

type ParsedSectionKey =
  | 'objectName'
  | 'objectNameAndCategory'
  | 'objectCategory'
  | 'primaryDescription'
  | 'shapeAndSilhouette'
  | 'materials'
  | 'dominantColors'
  | 'surfaceDetails'
  | 'colorsAndSurface'
  | 'surfaceDetailsAndFeatures'
  | 'distinctiveFeatures'
  | 'composition'
  | 'compositionAndPerspective'
  | 'viewingAngle'
  | 'background'
  | 'uncertainAttributes'
  | 'lightingNotes';

interface HeadingMatcher {
  readonly key: ParsedSectionKey;
  readonly patterns: readonly RegExp[];
}

const HEADING_MATCHERS: readonly HeadingMatcher[] = [
  {
    key: 'objectNameAndCategory',
    patterns: [
      /^(?:main\s+)?subject\s*(?:&|and|\/)\s*category$/i,
      /^object\s*(?:&|and|\/)\s*category$/i,
    ],
  },
  {
    key: 'objectName',
    patterns: [
      /^main\s+subject(?:\s+identity)?$/i,
      /^subject(?:\s+identity|\s+name)?$/i,
      /^object(?:\s+name|\s+identity)?$/i,
      /^primary\s+subject$/i,
    ],
  },
  {
    key: 'objectCategory',
    patterns: [
      /^(?:object\s+or\s+subject\s+)?category$/i,
      /^object\s+category$/i,
      /^subject\s+category$/i,
      /^classification$/i,
    ],
  },
  {
    key: 'primaryDescription',
    patterns: [
      /^(?:primary\s+)?description$/i,
      /^(?:overall\s+|visual\s+)?summary$/i,
      /^overview$/i,
    ],
  },
  {
    key: 'shapeAndSilhouette',
    patterns: [
      /^(?:overall\s+)?shape(?:\s+and\s+|\s*&\s*|\s*\/\s*)silhouette$/i,
      /^shape$/i,
      /^silhouette$/i,
      /^form(?:\s+and\s+silhouette)?$/i,
    ],
  },
  {
    key: 'colorsAndSurface',
    patterns: [
      /^colors?\s*(?:&|and|\/)\s*surface\s+details?$/i,
      /^colors?,?\s*materials?\s*(?:&|and)\s*surface\s+details?$/i,
    ],
  },
  {
    key: 'materials',
    patterns: [
      /^(?:visible\s+)?materials?(?:\s+and\s+|\s*&\s*)textures?$/i,
      /^(?:visible\s+)?materials?$/i,
      /^textures?$/i,
    ],
  },
  {
    key: 'dominantColors',
    patterns: [
      /^dominant\s+colors?$/i,
      /^colors?(?:\s+and\s+palette|\s+palette)?$/i,
      /^palette$/i,
    ],
  },
  {
    key: 'surfaceDetailsAndFeatures',
    patterns: [
      /^surface\s+details?\s*(?:&|and|\/)\s*(?:distinctive(?:\s+visual)?\s+)?features?$/i,
    ],
  },
  {
    key: 'surfaceDetails',
    patterns: [
      /^surface\s+details?$/i,
      /^textures?(?:\s+and\s+|\s*&\s*)surface\s+details?$/i,
      /^surface\s+finish$/i,
    ],
  },
  {
    key: 'distinctiveFeatures',
    patterns: [
      /^distinctive(?:\s+visual)?\s+features?$/i,
      /^key(?:\s+visual)?\s+features?$/i,
      /^notable\s+details?$/i,
    ],
  },
  {
    key: 'compositionAndPerspective',
    patterns: [
      /^composition\s*(?:&|and|\/)\s*(?:viewing\s+)?(?:perspective|angle)$/i,
      /^framing\s*(?:&|and|\/)\s*(?:perspective|angle)$/i,
    ],
  },
  {
    key: 'composition',
    patterns: [
      /^composition$/i,
      /^framing(?:\s+and\s+composition)?$/i,
      /^layout$/i,
    ],
  },
  {
    key: 'viewingAngle',
    patterns: [
      /^(?:camera\s+angle(?:\s+or\s+|\s*\/\s*)?)?viewing\s+(?:perspective|angle)$/i,
      /^camera\s+angle$/i,
      /^perspective$/i,
    ],
  },
  {
    key: 'background',
    patterns: [
      /^(?:visible\s+)?background$/i,
      /^environment(?:\s+context)?$/i,
      /^setting$/i,
    ],
  },
  {
    key: 'lightingNotes',
    patterns: [/^lighting(?:\s+notes?)?$/i, /^illumination$/i],
  },
  {
    key: 'uncertainAttributes',
    patterns: [
      /^uncertain(?:\s*(?:or|\/|and|&)\s*ambiguous)?\s+attributes?$/i,
      /^ambiguous\s+attributes?$/i,
      /^uncertainties$/i,
      /^observations?\s+vs\.?\s+assumptions?$/i,
    ],
  },
];

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .trim();
}

function matchSectionKey(rawLabel: string): ParsedSectionKey | null {
  const cleaned = stripMarkdownFormatting(rawLabel)
    .replace(/^[\d.\-*•#\s]+/, '')
    .replace(/[:\-–—]+$/, '')
    .trim();

  for (const matcher of HEADING_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(cleaned))) {
      return matcher.key;
    }
  }
  return null;
}

function cleanBulletPrefix(line: string): string {
  return line.replace(/^\s*(?:[-*•]+|\d+[.)])\s+/, '').trim();
}

function splitStructuredList(rawValue: string): string[] {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return [];
  }

  const normalizedLower = trimmed.toLowerCase();
  if (
    /^(?:none(?:\s+(?:observed|noted|identified|visible))?|n\/a|not\s+(?:visible|applicable|observed))\.?$/i.test(
      normalizedLower,
    )
  ) {
    return [];
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) =>
      cleanBulletPrefix(stripMarkdownFormatting(line)).replace(
        /^(?:materials?|textures?)\s*:\s*/i,
        '',
      ),
    )
    .filter((line) => line.length > 0);

  const items: string[] = [];
  for (const line of lines) {
    const parts = line
      .split(/[;,]/)
      .map((part) => part.replace(/\.$/, '').trim())
      .filter((part) => part.length > 0);
    for (const part of parts) {
      if (!items.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
        items.push(part);
      }
    }
  }

  return items;
}

function splitDistinctiveOrUncertainList(rawValue: string): string[] {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return [];
  }
  if (/^(?:none(?:\s+(?:observed|noted|identified|visible))?|n\/a)\.?$/i.test(trimmed)) {
    return [];
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => cleanBulletPrefix(stripMarkdownFormatting(line)))
    .filter((line) => line.length > 0);

  if (lines.length > 1) {
    return lines;
  }

  const single = lines[0] ?? '';
  if (single.includes(';')) {
    return single
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return single ? [single] : [];
}

function parseRawTextSections(rawText: string): {
  readonly sections: Partial<Record<ParsedSectionKey, string>>;
  readonly proseParagraphs: readonly string[];
} {
  const sections: Partial<Record<ParsedSectionKey, string>> = {};
  const proseParagraphs: string[] = [];
  const lines = rawText.split(/\r?\n/);

  let activeKey: ParsedSectionKey | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join('\n').trim();
    if (!joined) {
      buffer = [];
      return;
    }
    if (activeKey) {
      sections[activeKey] = sections[activeKey]
        ? `${sections[activeKey]}\n${joined}`
        : joined;
    } else {
      proseParagraphs.push(joined);
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (buffer.length > 0) {
        flush();
      }
      continue;
    }

    // Match markdown heading: ### Heading
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      const matchedKey = matchSectionKey(headingMatch[1]);
      if (matchedKey) {
        flush();
        activeKey = matchedKey;
        continue;
      }
    }

    // Match bullet/bold/plain label: "- **Label:** Value", "* **Label**: Value", or "Label: Value"
    const boldColonInsideMatch = trimmed.match(
      /^(?:[-*•]|\d+[.)])?\s*\*\*([^*:]+):\*\*\s*(.*)$/,
    );
    const labelValueMatch =
      boldColonInsideMatch ??
      trimmed.match(
        /^(?:[-*•]|\d+[.)])?\s*(?:\*\*([^*:]+?)\*\*|([A-Za-z][A-Za-z\s&/()-]{2,48}))\s*:\s*(.*)$/,
      );
    if (labelValueMatch) {
      const candidateLabel = boldColonInsideMatch
        ? labelValueMatch[1] ?? ''
        : labelValueMatch[1] ?? labelValueMatch[2] ?? '';
      const remainder = boldColonInsideMatch
        ? (labelValueMatch[2] ?? '').trim()
        : (labelValueMatch[3] ?? '').trim();
      const matchedKey = matchSectionKey(candidateLabel);
      if (matchedKey) {
        flush();
        activeKey = matchedKey;
        if (remainder.length > 0) {
          buffer.push(stripMarkdownFormatting(remainder));
        }
        continue;
      }
    }

    buffer.push(trimmed);
  }

  flush();

  return { sections, proseParagraphs };
}

function extractColorPhrases(text: string): string[] {
  const colorPattern =
    /\b(?:(?:light|dark|bright|muted|warm|cool|deep|pale|soft|matte|glossy|royal|navy|cobalt|sky|slate|olive|forest|emerald|ochre|terracotta|burnt|ivory|cream|off-white|charcoal)\s+){0,2}(?:beige\/cream|greyish-brown|grey-beige|off-white\/cream|white|black|grey|gray|brown|taupe|beige|cream|ivory|blue|red|green|yellow|orange|purple|violet|pink|gold|silver|copper|bronze|amber|umber|cobalt|navy|teal|indigo|crimson|maroon|tan)\b/gi;
  const matches = text.match(colorPattern) ?? [];
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const m of matches) {
    const clean = m.trim().replace(/\s+/g, ' ');
    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      colors.push(clean.charAt(0).toUpperCase() + clean.slice(1));
    }
  }
  return colors.slice(0, 6);
}

function extractViewingAngleFromPerspective(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const angleSentence = sentences.find((s) =>
    /\b(?:angle|perspective|view|viewed|eye-level|elevated|overhead|top-down|close-up|profile|three-quarter|front)\b/i.test(
      s,
    ),
  );
  return angleSentence ?? '';
}

function deriveConciseObjectName(rawSubjectText: string): string {
  const cleaned = stripMarkdownFormatting(rawSubjectText)
    .replace(/^(?:the\s+(?:image|photo|photograph)\s+(?:shows|depicts|features|contains)\s+(?:an?\s+)?)/i, '')
    .replace(/^(?:(?:a|an)\s+(?:2d\s+)?(?:digital\s+)?(?:illustration|drawing|photo|photograph|image|render|painting)\s+of\s+(?:an?\s+)?)/i, '')
    .replace(/^(?:an?\s+)/i, '')
    .replace(/\([^)]*\)/g, '')
    .trim();

  if (!cleaned) {
    return 'Observed Visual Subject';
  }

  const firstSentence = cleaned.split(/[.!?](?:\s|$)/)[0]?.trim() ?? cleaned;
  const firstClause =
    firstSentence
      .split(/\s+(?:with|featuring|resting|placed|set|against|on)\s+/i)[0]
      ?.trim() ?? firstSentence;
  const candidate = firstClause.length > 0 ? firstClause : firstSentence;

  if (candidate.length <= 72) {
    return candidate.charAt(0).toUpperCase() + candidate.slice(1);
  }
  const truncated = candidate.slice(0, 69).trim();
  return `${truncated}...`;
}

function deriveCategory(
  explicitCategory: string | undefined,
  subjectText: string,
  description: string,
): string {
  if (explicitCategory && explicitCategory.trim().length > 0) {
    return stripMarkdownFormatting(explicitCategory).replace(/\.$/, '').trim();
  }

  const parenMatch = subjectText.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1].trim().length > 0 && parenMatch[1].trim().length <= 40) {
    const label = parenMatch[1].trim();
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  const combined = `${subjectText} ${description}`.toLowerCase();
  if (/\b(?:vase|pitcher|bowl|cup|mug|pottery|ceramic|vessel|jar|plate|drinkware)\b/.test(combined)) {
    return 'Drinkware / Ceramic Vessel';
  }
  if (/\b(?:chair|table|lamp|desk|sofa|furniture|stool)\b/.test(combined)) {
    return 'Furniture / Interior Object';
  }
  if (/\b(?:camera|watch|clock|headphone|speaker|device|phone|tool)\b/.test(combined)) {
    return 'Product / Industrial Design';
  }
  if (/\b(?:flower|plant|leaf|botanical|tree|fruit)\b/.test(combined)) {
    return 'Botanical / Natural Subject';
  }
  if (/\b(?:portrait|person|figure|man|woman|character)\b/.test(combined)) {
    return 'Portrait / Figure Study';
  }
  if (/\b(?:building|facade|architecture|tower|bridge|interior)\b/.test(combined)) {
    return 'Architectural Subject';
  }
  if (/\b(?:sculpture|statue|bust|figurine|carving)\b/.test(combined)) {
    return 'Sculpture / 3D Form';
  }
  return 'Visual Subject';
}

function buildPreservationPriorities(params: {
  readonly objectName: string;
  readonly shapeAndSilhouette: string;
  readonly materials: readonly string[];
  readonly dominantColors: readonly string[];
  readonly distinctiveFeatures: readonly string[];
}): string[] {
  const priorities: string[] = [];

  if (params.objectName && params.objectName !== 'Observed Visual Subject') {
    priorities.push(`Subject identity: ${params.objectName}`);
  }
  if (params.shapeAndSilhouette) {
    priorities.push('Overall silhouette and proportions');
  }
  if (params.materials.length > 0) {
    priorities.push(
      `Surface materials (${params.materials.slice(0, 3).join(', ')})`,
    );
  }
  if (params.dominantColors.length > 0) {
    priorities.push(
      `Color palette (${params.dominantColors.slice(0, 4).join(', ')})`,
    );
  }
  for (const feature of params.distinctiveFeatures.slice(0, 2)) {
    priorities.push(feature);
  }

  return priorities;
}

export function normalizeRawVisionToObjectAnalysis(
  raw: RawVisionAnalysisResult,
  analysisId: string = createEntityId('anl'),
): ObjectAnalysis {
  const { sections, proseParagraphs } = parseRawTextSections(raw.rawText);

  const rawSubject = sections.objectNameAndCategory
    ? stripMarkdownFormatting(sections.objectNameAndCategory)
    : sections.objectName
      ? stripMarkdownFormatting(sections.objectName)
      : proseParagraphs[0] ?? raw.rawText;

  const objectName = deriveConciseObjectName(rawSubject);

  const primaryDescriptionCandidates = [
    sections.primaryDescription
      ? stripMarkdownFormatting(sections.primaryDescription)
      : '',
    sections.objectNameAndCategory
      ? stripMarkdownFormatting(sections.objectNameAndCategory)
      : '',
    sections.objectName ? stripMarkdownFormatting(sections.objectName) : '',
    ...proseParagraphs.map((p) => stripMarkdownFormatting(p)),
  ].filter((part) => part.length > 0);

  const primaryDescription =
    primaryDescriptionCandidates[0] ??
    stripMarkdownFormatting(raw.rawText).split(/\r?\n\r?\n/)[0]?.trim() ??
    objectName;

  const objectCategory = deriveCategory(
    sections.objectCategory,
    rawSubject,
    primaryDescription,
  );

  const shapeAndSilhouette = sections.shapeAndSilhouette
    ? stripMarkdownFormatting(sections.shapeAndSilhouette)
    : '';

  const materials = sections.materials
    ? splitStructuredList(sections.materials)
    : [];

  const colorsAndSurfaceClean = sections.colorsAndSurface
    ? sections.colorsAndSurface
        .split(/\r?\n/)
        .map((l) => cleanBulletPrefix(stripMarkdownFormatting(l)))
        .filter(Boolean)
        .join(' ')
    : '';

  const dominantColors = sections.dominantColors
    ? splitStructuredList(sections.dominantColors)
    : colorsAndSurfaceClean
      ? extractColorPhrases(colorsAndSurfaceClean)
      : [];

  const surfaceDetails = sections.surfaceDetails
    ? stripMarkdownFormatting(sections.surfaceDetails)
    : sections.surfaceDetailsAndFeatures
      ? stripMarkdownFormatting(sections.surfaceDetailsAndFeatures)
      : colorsAndSurfaceClean;

  const distinctiveFeatures = sections.distinctiveFeatures
    ? splitDistinctiveOrUncertainList(sections.distinctiveFeatures)
    : sections.surfaceDetailsAndFeatures
      ? splitDistinctiveOrUncertainList(sections.surfaceDetailsAndFeatures)
      : [];

  const compositionParts = [
    sections.compositionAndPerspective
      ? stripMarkdownFormatting(sections.compositionAndPerspective)
      : '',
    sections.composition ? stripMarkdownFormatting(sections.composition) : '',
    sections.background
      ? `Background: ${stripMarkdownFormatting(sections.background)}`
      : '',
  ].filter(Boolean);

  const composition = compositionParts.join(' ');

  const viewingAngle = sections.viewingAngle
    ? stripMarkdownFormatting(sections.viewingAngle)
    : sections.compositionAndPerspective
      ? extractViewingAngleFromPerspective(
          stripMarkdownFormatting(sections.compositionAndPerspective),
        )
      : '';

  const uncertainAttributes = sections.uncertainAttributes
    ? splitDistinctiveOrUncertainList(sections.uncertainAttributes)
    : [];

  const preservationPriorities = buildPreservationPriorities({
    objectName,
    shapeAndSilhouette,
    materials,
    dominantColors,
    distinctiveFeatures,
  });

  const detectedObject: DetectedObjectItem = {
    id: createEntityId('obj'),
    label: objectName,
    category: objectCategory,
    confidence: uncertainAttributes.length > 0 ? 0.85 : 0.92,
    spatialPosition: viewingAngle || 'Primary focal frame',
    dominantColors,
    materials,
    keyAttributes: distinctiveFeatures,
  };

  const now = nowIsoTimestamp();

  return {
    id: analysisId,
    projectId: raw.projectId,
    sourceAssetId: raw.sourceAssetId,
    providerId: raw.providerId,
    modelId: raw.modelId,
    ...(raw.modelVersion ? { modelVersion: raw.modelVersion } : {}),
    ...(raw.responseId ? { responseId: raw.responseId } : {}),
    ...(raw.finishReason ? { finishReason: raw.finishReason } : {}),
    rawText: raw.rawText,
    sceneSummary: primaryDescription,
    detectedObjects: [detectedObject],
    lightingNotes: sections.lightingNotes
      ? stripMarkdownFormatting(sections.lightingNotes)
      : '',
    compositionNotes: composition,
    objectName,
    objectCategory,
    primaryDescription,
    shapeAndSilhouette,
    materials,
    dominantColors,
    surfaceDetails,
    distinctiveFeatures,
    composition,
    viewingAngle,
    preservationPriorities,
    uncertainAttributes,
    analyzedAt: raw.analyzedAt,
    createdAt: now,
    updatedAt: now,
  };
}
