import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type {
  ArtStyle,
  ArtStyleCategory,
  CuratedArtStyleCategory,
  PromptDetailLevel,
  StyleCatalogItem,
} from '../../types/domain.ts';
import type { StyleQueryOptions, StyleSortOption } from '../../types/services.ts';
import { isValidEntityId, isValidIsoTimestamp } from '../../utils/ids.ts';
import {
  findCredentialLeakKey,
  isNonEmptyString,
  isPlainRecord,
} from '../../utils/validation.ts';
import { findForbiddenImageInput } from '../image-generation/contract.ts';

export interface CuratedCategoryMeta {
  readonly id: CuratedArtStyleCategory | 'all';
  readonly label: string;
  readonly shortLabel: string;
}

export const CURATED_STYLE_CATEGORIES: readonly CuratedCategoryMeta[] = [
  { id: 'all', label: 'All Styles', shortLabel: 'All' },
  { id: 'illustration', label: 'Illustration', shortLabel: 'Illustration' },
  { id: 'graphic_design', label: 'Graphic Design', shortLabel: 'Graphic Design' },
  { id: 'line_art', label: 'Line Art', shortLabel: 'Line Art' },
  { id: 'traditional_art', label: 'Traditional Art', shortLabel: 'Traditional' },
  { id: 'digital_art', label: 'Digital Art', shortLabel: 'Digital Art' },
  { id: '3d_art', label: '3D Art', shortLabel: '3D Art' },
] as const;

export const CURATED_STYLE_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  all: 'All Styles',
  illustration: 'Illustration',
  graphic_design: 'Graphic Design',
  line_art: 'Line Art',
  traditional_art: 'Traditional Art',
  digital_art: 'Digital Art',
  '3d_art': '3D Art',
  painterly: 'Painterly',
  photographic: 'Photographic',
  sculptural: 'Sculptural',
  architectural: 'Architectural',
  digital: 'Digital',
  printmaking: 'Printmaking',
  mixed_media: 'Mixed Media',
};

const CATALOG_TIMESTAMP = '2026-11-15T00:00:00.000Z' as const;

const ALLOWED_DETAIL_LEVELS: ReadonlySet<PromptDetailLevel> = new Set([
  'minimal',
  'balanced',
  'high',
  'intricate',
]);

function deepFreezeStyle(style: ArtStyle): ArtStyle {
  Object.freeze(style.styleDirectives);
  Object.freeze(style.mediumKeywords);
  Object.freeze(style.lightingKeywords);
  Object.freeze(style.defaultNegativeDirectives);
  Object.freeze(style.recommendedAspectRatios);
  if (style.tags) {
    Object.freeze(style.tags);
  }
  if (style.previewAsset) {
    Object.freeze(style.previewAsset.palette);
    Object.freeze(style.previewAsset);
  }
  return Object.freeze(style);
}

const RAW_CURATED_ART_STYLES: readonly ArtStyle[] = [
  {
    id: 'sty_flat_editorial_01',
    slug: 'flat-editorial-illustration',
    name: 'Flat Editorial Illustration',
    category: 'illustration',
    summary:
      'Contemporary print-editorial illustration with bold flat planes, restrained mid-century ink grain, and high legibility.',
    shortDescription:
      'Crisp flat color planes, minimal perspective distortion, and modern magazine-editorial poise.',
    description:
      'Inspired by contemporary international editorial magazines, this style distills the subject into confident flat shapes, intentional negative space, and tactile risograph-adjacent paper grain without photorealistic clutter.',
    styleDirectives: [
      'Flat editorial vector-inspired shapes',
      'Minimalist depth cues with clear silhouette hierarchy',
      'Subtle matte paper print texture',
    ],
    mediumKeywords: ['flat editorial illustration', 'gouache-matte digital print', 'screenprint finish'],
    lightingKeywords: ['even ambient daylight', 'minimal directional cast shadow'],
    defaultNegativeDirectives: [
      'photorealistic textures',
      '3D glossy reflections',
      'heavy drop shadows',
      'lens flare',
    ],
    recommendedAspectRatios: ['4:3', '1:1', '3:4'],
    visualCharacteristics:
      'Clean graphic abstraction, strong silhouette separation, and deliberate editorial breathing room.',
    renderingTechnique:
      'Matte flat-color editorial rendering with subtle dry-ink edge modulation and restrained tonal overlap.',
    renderingRules:
      'Matte flat-color editorial rendering with subtle dry-ink edge modulation and restrained tonal overlap.',
    lineworkRules:
      'Minimal or implied contours defined primarily by crisp color-plane boundaries and selective fine accent strokes.',
    colorRules:
      'Curated mid-century palette of terracotta, cobalt blue, warm bone ivory, and deep charcoal inks.',
    textureRules:
      'Fine uncoated cotton editorial stock grain with whisper-light risograph registration warmth.',
    shadingRules:
      'Flat two-tone block shadows and broad geometric tonal steps instead of soft airbrushed gradients.',
    compositionRules:
      'Balanced asymmetrical editorial framing with generous uncluttered margins around the focal subject.',
    detailLevel: 'balanced',
    promptTemplate:
      'Contemporary flat editorial illustration featuring clean matte color shapes, subtle uncoated paper grain, and disciplined negative space.',
    negativePromptTemplate:
      'photorealistic skin, 3D specular gloss, soft airbrush gradients, busy background clutter',
    tags: ['editorial', 'flat', 'magazine', 'clean shapes', 'matte', 'print'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'editorial_arch',
      palette: ['#F3ECE0', '#315BDE', '#D4623F', '#17191E'],
      accentNote: 'Matte editorial planes',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_japanese_anime_02',
    slug: 'japanese-anime-background',
    name: 'Japanese Anime Background',
    category: 'illustration',
    summary:
      'Hand-painted cel-animation background art with luminous atmospheric perspective, crisp architectural poise, and serene sky light.',
    shortDescription:
      'Painterly studio background art with sunlit atmospheric depth, soft clouds, and evocative warmth.',
    description:
      'Modeled after classic theatrical Japanese animation background painting, pairing crisp hand-drafted form accuracy with rich gouache-style atmospheric light, gentle foliage washes, and tranquil depth.',
    styleDirectives: [
      'Hand-painted animation background gouache',
      'Luminous atmospheric depth and sunlit air',
      'Crisp architectural and object fidelity',
    ],
    mediumKeywords: ['hand-painted gouache', 'theatrical anime background art', 'watercolor atmospheric wash'],
    lightingKeywords: ['golden afternoon sunlight', 'soft rim bloom', 'cool ambient shadow bounce'],
    defaultNegativeDirectives: [
      'flat vector clip art',
      'harsher neon CGI',
      'muddy desaturated noise',
      'heavy dark vignette',
    ],
    recommendedAspectRatios: ['16:9', '3:2', '4:3'],
    visualCharacteristics:
      'Luminous theatrical warmth, crisp painted edge control, and gentle atmospheric haze separating planes.',
    renderingTechnique:
      'Layered matte gouache and digital brush painting emulating traditional studio cel-animation scenery.',
    renderingRules:
      'Layered matte gouache and digital brush painting emulating traditional studio cel-animation scenery.',
    lineworkRules:
      'Delicate hand-drawn drafting ink contours softened subtly under warm atmospheric highlights.',
    colorRules:
      'Sunlit sky blues, warm cream highlights, sage botanical greens, and cool slate-violet shadows.',
    textureRules:
      'Fine hand-brushed gouache pigment transitions with clean painted surfaces and subtle paper tooth.',
    shadingRules:
      'Warm directional sunlight paired with luminous cool-tinted bounce shadows and soft painterly speculars.',
    compositionRules:
      'Cinematic breathing room framing the subject clearly against calm atmospheric backdrop planes.',
    detailLevel: 'high',
    promptTemplate:
      'Theatrical Japanese anime background illustration painted in luminous gouache, balanced sunlit highlights, and cool atmospheric shadows.',
    negativePromptTemplate:
      'harsh 3D plastic shading, flat clip art, photographic lens grain, noisy glitch artifacts',
    tags: ['anime', 'painterly', 'gouache', 'atmospheric', 'sunlit', 'cinematic'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'anime_horizon',
      palette: ['#E9F2FA', '#4B83C3', '#F4C67A', '#26384A'],
      accentNote: 'Luminous gouache atmosphere',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_geom_editorial_03',
    slug: 'geometric-editorial-illustration',
    name: 'Geometric Editorial Illustration',
    category: 'illustration',
    summary:
      'Structured modernist illustration constructed from interlocking arcs, crisp tangents, and architectural proportion.',
    shortDescription:
      'Precision-built geometric forms with clean rhythmic arcs and Swiss-editorial discipline.',
    description:
      'A disciplined visual language translating organic and manufactured subjects into harmonious circles, chamfers, and interlocking planar volumes with crisp editorial contrast.',
    styleDirectives: [
      'Interlocking Euclidean geometry and clean tangents',
      'Rhythmic planar overlap',
      'Sharp modern editorial composition',
    ],
    mediumKeywords: ['geometric illustration', 'architectural vector study', 'precision silkscreen'],
    lightingKeywords: ['crisp stepped tonal falloff', 'clean studio side-light'],
    defaultNegativeDirectives: [
      'sketchy messy lines',
      'organic grunge splatters',
      'soft blurred edges',
      'photographic bokeh',
    ],
    recommendedAspectRatios: ['1:1', '3:4', '4:3'],
    visualCharacteristics:
      'Mathematical elegance, crisp edge tangents, and rhythmic balance between solid fill and open margin.',
    renderingTechnique:
      'Hard-edge planar geometric construction with subtly textured matte ink fills and micro-halftone accents.',
    renderingRules:
      'Hard-edge planar geometric construction with subtly textured matte ink fills and micro-halftone accents.',
    lineworkRules:
      'Uniform razor-clean geometric contours paired with crisp unoutlined shape intersections.',
    colorRules:
      'Warm mineral ochre, cobalt slate, crimson accent, cream parchment, and deep ink black.',
    textureRules:
      'Ultra-subtle stipple grain inside shadow planes while keeping primary geometry crisp.',
    shadingRules:
      'Faceted geometric gradient bands and hard-edged shadow wedges aligned to clean angles.',
    compositionRules:
      'Centralized architectural grid alignment with balanced asymmetrical counterpoint.',
    detailLevel: 'balanced',
    promptTemplate:
      'Geometric editorial illustration composed of crisp interlocking arcs, disciplined grid alignment, and matte mineral ink tones.',
    negativePromptTemplate:
      'messy hand sketch, painterly brushstrokes, photorealistic noise, blurry depth of field',
    tags: ['geometric', 'editorial', 'modernist', 'structured', 'clean edges'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'geometric_study',
      palette: ['#F2EFE6', '#2852C8', '#E09F3E', '#181A1F'],
      accentNote: 'Interlocking planar geometry',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_retro_psych_04',
    slug: 'retro-psychedelic-gradient',
    name: 'Retro Psychedelic Gradient',
    category: 'graphic_design',
    summary:
      'Late-60s and 70s graphic poster aesthetic fusing fluid chromatic ribbons, airbrush aura fades, and bold tonal contrast.',
    shortDescription:
      'Fluid retro spectrum waves, velvety airbrush fades, and nostalgic poster vibrancy.',
    description:
      'Draws from vintage concert and exhibition poster graphics with undulating contour bands, warm analog film halation, and velvety tonal transitions that maintain clean subject readability.',
    styleDirectives: [
      'Fluid 1970s chromatic wave geometry',
      'Velvety analog airbrush gradient transitions',
      'Vintage print halation warmth',
    ],
    mediumKeywords: ['retro poster design', 'analog airbrush print', 'vintage silkscreen gradient'],
    lightingKeywords: ['luminous chromatic rim glow', 'warm sunset aura'],
    defaultNegativeDirectives: [
      'sterile corporate minimalism',
      'clinical monochrome',
      'sharp metallic chrome',
      'photorealistic grime',
    ],
    recommendedAspectRatios: ['3:4', '2:3', '1:1'],
    visualCharacteristics:
      'Hypnotic curved bands, saturated sunset gradients, and unmistakable vintage analog print warmth.',
    renderingTechnique:
      'Smooth analog airbrush blends combined with bold screenprinted silhouette boundaries.',
    renderingRules:
      'Smooth analog airbrush blends combined with bold screenprinted silhouette boundaries.',
    lineworkRules:
      'Flowing rhythmic contour bands and bold unbroken outer silhouettes.',
    colorRules:
      'Burnt tangerine, acid chartreuse, plum violet, warm magenta, and cream paper highlights.',
    textureRules:
      'Fine vintage offset print grain and soft airbrush mist texture across broad color sweeps.',
    shadingRules:
      'Luminous radial gradient contours that sculpt subject volume through color temperature shifts.',
    compositionRules:
      'Poster-centric heroic scale anchored by rhythmic radiating curves.',
    detailLevel: 'balanced',
    promptTemplate:
      'Retro 1970s psychedelic graphic poster design with fluid undulating contours, velvety airbrush gradients, and warm vintage print texture.',
    negativePromptTemplate:
      'sterile gray corporate look, photorealistic camera lens distortion, harsh digital noise',
    tags: ['retro', 'psychedelic', 'gradient', '70s poster', 'airbrush', 'vibrant'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'psychedelic_wave',
      palette: ['#2B193D', '#E85D3F', '#F3B73F', '#D7F36A'],
      accentNote: 'Velvety retro spectrum fades',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_monoline_geom_05',
    slug: 'monoline-geometric-line-art',
    name: 'Monoline Geometric Line Art',
    category: 'line_art',
    summary:
      'Technical-drafting clarity using continuous single-weight ink lines, clean geometric curves, and airy open paper.',
    shortDescription:
      'Constant-stroke technical ink lines, open negative space, and crisp architectural precision.',
    description:
      'Celebrates pure linear craftsmanship: every curve and structural edge is drawn with an unwavering uniform stroke weight, pairing industrial-design drafting precision with quiet editorial minimalism.',
    styleDirectives: [
      'Uniform constant-width monoline ink strokes',
      'Minimalist unfilled negative space',
      'Technical-drafting clarity and clean joins',
    ],
    mediumKeywords: ['monoline technical drawing', 'architectural fineliner ink', 'precision vector line art'],
    lightingKeywords: ['unshaded flat illumination', 'minimal implied contour light'],
    defaultNegativeDirectives: [
      'heavy painterly shading',
      'thick variable calligraphy',
      'photorealistic textures',
      'muddy gradients',
    ],
    recommendedAspectRatios: ['1:1', '4:3', '3:4'],
    visualCharacteristics:
      'Razor-clean single-weight contour lines on calm ivory ground with zero visual clutter.',
    renderingTechnique:
      'Crisp single-weight technical pen linework with optional pinpoint spot-color accent plane.',
    renderingRules:
      'Crisp single-weight technical pen linework with optional pinpoint spot-color accent plane.',
    lineworkRules:
      'Continuous uniform-thickness strokes with clean rounded caps, crisp corners, and consistent spacing.',
    colorRules:
      'Deep obsidian ink on warm archival ivory stock, optionally accented with one muted cobalt detail.',
    textureRules:
      'Clean matte drafting vellum ground without ink bleed or rough paper distortion.',
    shadingRules:
      'Zero soft tonal shading; form depth conveyed solely through overlapping contour geometry and sparse parallel rule lines.',
    compositionRules:
      'Centered technical specimen layout surrounded by generous breathing space.',
    detailLevel: 'minimal',
    promptTemplate:
      'Monoline geometric line art drawn in crisp single-weight architectural ink strokes over warm archival ivory paper with ample negative space.',
    negativePromptTemplate:
      'soft airbrush shading, painted brushstrokes, variable calligraphy thickness, photographic realism',
    tags: ['monoline', 'line art', 'technical drawing', 'minimal', 'drafting', 'clean'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'monoline_vessel',
      palette: ['#F7F4EC', '#17191E', '#315BDE', '#D9D4C8'],
      accentNote: 'Uniform single-weight linework',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_matisse_floral_06',
    slug: 'matisse-cut-out-floral',
    name: 'Matisse Cut-Out Floral',
    category: 'illustration',
    summary:
      'Expressive gouache-painted paper cut-outs featuring organic scissor-trimmed silhouettes, playful rhythm, and joyful pigment.',
    shortDescription:
      'Hand-cut gouache paper forms with lively organic curves and vibrant Mediterranean hues.',
    description:
      'Honors tactile modernist paper-cut collage: shapes carry the crisp, slightly imperfect warmth of hand-guided shears slicing heavy gouache-coated paper, layered cleanly against sunlit ivory grounds.',
    styleDirectives: [
      'Hand-cut gouache paper collage shapes',
      'Expressive organic botanical and sculptural curves',
      'Layered paper-edge tactile immediacy',
    ],
    mediumKeywords: ['gouache paper cut-out', 'modernist collage illustration', 'tactile paper shapes'],
    lightingKeywords: ['flat sunlit gallery light', 'whisper-thin paper edge separation'],
    defaultNegativeDirectives: [
      'photorealistic 3D render',
      'thin mechanical CAD lines',
      'dark moody shadows',
      'airbrushed chrome',
    ],
    recommendedAspectRatios: ['3:4', '1:1', '4:3'],
    visualCharacteristics:
      'Joyful scissor-cut silhouettes, saturated opaque gouache pigment, and rhythmic negative-positive interplay.',
    renderingTechnique:
      'Opaque matte gouache-brushed paper shapes layered cleanly with crisp hand-trimmed edges.',
    renderingRules:
      'Opaque matte gouache-brushed paper shapes layered cleanly with crisp hand-trimmed edges.',
    lineworkRules:
      'No dark outlines; forms emerge directly from energetic scissor-cut silhouettes and shape counter-forms.',
    colorRules:
      'Ultramarine blue, coral vermilion, sun-baked ochre, emerald leaf green, and warm off-white paper.',
    textureRules:
      'Authentic heavy matte gouache brushwork visible within flat cut-paper surfaces.',
    shadingRules:
      'Flat unshaded pigment blocks separated purely by crisp layered paper edges.',
    compositionRules:
      'Lively rhythmic balance filling the frame gracefully while preserving calm ivory breathing zones.',
    detailLevel: 'minimal',
    promptTemplate:
      'Modernist Matisse-inspired gouache paper cut-out artwork with crisp scissor-trimmed organic shapes, saturated opaque pigments, and warm ivory background.',
    negativePromptTemplate:
      'fine black ink outlines, photorealistic lighting, glossy plastic render, gradients',
    tags: ['matisse', 'cut-out', 'collage', 'gouache', 'organic', 'modernist'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'matisse_foliage',
      palette: ['#F7F3EA', '#1D4ED8', '#E0533C', '#2E7D5B'],
      accentNote: 'Gouache paper cut-out shapes',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_bauhaus_geom_07',
    slug: 'bauhaus-geometric',
    name: 'Bauhaus Geometric',
    category: 'graphic_design',
    summary:
      'Constructivist primary geometry balancing circle, triangle, and orthogonal rhythm with disciplined typographic clarity.',
    shortDescription:
      'Iconic constructivist balance of primary pigments, warm cream ground, and crisp geometric order.',
    description:
      'Rooted in Weimar modernist workshop design: reduces the subject to its fundamental geometric truth using balanced primary tones, strong diagonal tension, and archival poster paper poise.',
    styleDirectives: [
      'Constructivist primary geometry (circle, triangle, square)',
      'Asymmetrical grid discipline',
      'Archival exhibition poster balance',
    ],
    mediumKeywords: ['Bauhaus graphic poster', 'constructivist lithograph', 'modernist geometric print'],
    lightingKeywords: ['flat constructivist illumination', 'hard-edge shadow blocks'],
    defaultNegativeDirectives: [
      'ornate flourishes',
      'soft watercolor bleeds',
      'photorealistic depth',
      'decorative gradients',
    ],
    recommendedAspectRatios: ['3:4', '1:1', '2:3'],
    visualCharacteristics:
      'Bold architectural balance, unembellished primary planes, and crisp typographic poster restraint.',
    renderingTechnique:
      'Solid matte lithographic color blocks with crisp intersecting geometric planes.',
    renderingRules:
      'Solid matte lithographic color blocks with crisp intersecting geometric planes.',
    lineworkRules:
      'Straight orthogonal rules and crisp compass-drawn arcs anchoring shape intersections.',
    colorRules:
      'Bauhaus crimson red, cobalt blue, cadmium yellow, charcoal black, and warm aged cream.',
    textureRules:
      'Subtle vintage matte lithograph ink density on warm heavy archival poster paper.',
    shadingRules:
      'Strict flat color blocking or halved-circle tonal divisions with zero gradient softness.',
    compositionRules:
      'Dynamic diagonal or modular grid alignment uniting subject silhouette with supporting bars.',
    detailLevel: 'minimal',
    promptTemplate:
      'Bauhaus geometric graphic design built from primary-colored circles, triangles, and orthogonal bars over warm cream poster paper.',
    negativePromptTemplate:
      'soft gradients, organic textures, ornate victorian filigree, photorealism',
    tags: ['bauhaus', 'constructivist', 'primary colors', 'poster', 'grid', 'minimal'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'bauhaus_grid',
      palette: ['#F2ECE0', '#C93B2B', '#2553B8', '#E2AF2E'],
      accentNote: 'Constructivist primary geometry',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_vintage_engrav_08',
    slug: 'vintage-engraving',
    name: 'Vintage Engraving',
    category: 'traditional_art',
    summary:
      '19th-century copperplate and wood-engraving precision using disciplined burin hatching and fine archival cream inkwork.',
    shortDescription:
      'Intricate copperplate cross-hatching, fine stipple contours, and timeless archival print craft.',
    description:
      'Evokes classic natural-history plates and bespoke encyclopedia engravings: volume, sheen, and shadow emerge exclusively through varied directional hatching, contour-hugging line density, and stippled tonal gradations.',
    styleDirectives: [
      'Fine copperplate and wood-engraving burin lines',
      'Form-following directional cross-hatching',
      'Timeless botanical/encyclopedic plate poise',
    ],
    mediumKeywords: ['copperplate engraving', 'archival etching', 'intaglio printmaking'],
    lightingKeywords: ['classic studio directional highlight', 'high-contrast ink chiaroscuro'],
    defaultNegativeDirectives: [
      'bright modern neon colors',
      'smooth airbrush gradients',
      'flat vector fills',
      'plastic 3D gloss',
    ],
    recommendedAspectRatios: ['3:4', '1:1', '4:3'],
    visualCharacteristics:
      'Museum-grade ink line density, crisp carved shadow hatching, and warm antique rag-paper elegance.',
    renderingTechnique:
      'Precision intaglio ink engraving built entirely from tapered parallel lines, cross-hatching, and dot stippling.',
    renderingRules:
      'Precision intaglio ink engraving built entirely from tapered parallel lines, cross-hatching, and dot stippling.',
    lineworkRules:
      'Crisp tapered burin strokes that curve along 3D surface contours and tighten in deep shadow crevices.',
    colorRules:
      'Deep sepia-charcoal or archival iron-gall black ink over warm cream laid cotton paper.',
    textureRules:
      'Fine laid rag-paper grain with subtle intaglio plate impression clarity.',
    shadingRules:
      'Dense cross-hatching in recesses tapering cleanly to open bare paper on bright highlights.',
    compositionRules:
      'Classical centered specimen framing with refined negative margin.',
    detailLevel: 'intricate',
    promptTemplate:
      '19th-century vintage copperplate engraving featuring contour-hugging burin cross-hatching, fine stippled shading, and deep sepia-black ink on warm cream rag paper.',
    negativePromptTemplate:
      'digital gradients, neon hues, soft airbrush blur, photorealistic color photo',
    tags: ['engraving', 'etching', 'vintage', 'cross-hatching', 'printmaking', 'archival'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'engraving_crosshatch',
      palette: ['#F3EBD8', '#2A241E', '#6B5E4E', '#CFC3AB'],
      accentNote: 'Copperplate burin cross-hatching',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_watercolor_book_09',
    slug: 'watercolor-storybook',
    name: 'Watercolor Storybook',
    category: 'traditional_art',
    summary:
      'Hand-painted cold-press watercolor and fine sepia ink bringing gentle warmth, translucent pigment blooms, and storybook charm.',
    shortDescription:
      'Translucent mineral pigment washes, gentle ink contours, and cold-press paper texture.',
    description:
      'Combines delicate pen-and-ink draftsmanship with layered transparent watercolor washes, natural pigment pooling at edges, and soft unpainted paper highlights for an inviting illustrated-book feel.',
    styleDirectives: [
      'Translucent layered watercolor washes',
      'Natural wet-on-dry pigment blooms',
      'Delicate hand-drawn ink accents',
    ],
    mediumKeywords: ['cold-press watercolor', 'ink and wash illustration', 'storybook pigment paint'],
    lightingKeywords: ['soft diffused window daylight', 'luminous paper-white highlights'],
    defaultNegativeDirectives: [
      'opaque plastic CGI',
      'hard neon vectors',
      'heavy black shadows',
      'digital lens flare',
    ],
    recommendedAspectRatios: ['4:3', '3:4', '1:1'],
    visualCharacteristics:
      'Airy paper luminosity, delicate pigment granulation, and gentle hand-crafted storybook warmth.',
    renderingTechnique:
      'Transparent mineral watercolor glazes over light hand-drawn sepia ink underdrawing.',
    renderingRules:
      'Transparent mineral watercolor glazes over light hand-drawn sepia ink underdrawing.',
    lineworkRules:
      'Expressive fine sepia dip-pen lines with subtle organic variation and breathing gaps.',
    colorRules:
      'Warm honey ochre, muted sage, dusty rose, cerulean wash, and natural ivory paper whites.',
    textureRules:
      'Authentic cold-press cotton watercolor paper tooth with soft dried pigment bloom rings.',
    shadingRules:
      'Layered translucent glazes darkening gently in shadows while leaving bright highlights unpainted.',
    compositionRules:
      'Intimate, welcoming centered framing with soft vignette fade toward clean paper edges.',
    detailLevel: 'high',
    promptTemplate:
      'Hand-painted watercolor storybook illustration on cold-press cotton paper with translucent pigment washes, delicate sepia ink contours, and luminous unpainted highlights.',
    negativePromptTemplate:
      'harsh 3D CGI, opaque digital neon, heavy dark gradients, glossy plastic surfaces',
    tags: ['watercolor', 'storybook', 'traditional', 'wash', 'cold-press', 'hand-painted'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'watercolor_wash',
      palette: ['#F9F6EE', '#5E8C9E', '#D88C6F', '#8EA67A'],
      accentNote: 'Translucent cold-press pigment washes',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_3d_clay_render_10',
    slug: '3d-clay-render',
    name: '3D Clay Render',
    category: '3d_art',
    summary:
      'Tactile miniature-maquette 3D aesthetic with soft matte polymer clay surfaces, rounded bevels, and diffused studio softbox light.',
    shortDescription:
      'Soft matte sculpted clay volumes, rounded tactile bevels, and diffused studio lighting.',
    description:
      'Translates the subject into a charming physical-maquette 3D sculpture crafted from smooth matte modeling clay, lit inside a soft daylight tabletop studio with creamy ambient occlusion.',
    styleDirectives: [
      'Matte sculpted polymer clay surface finish',
      'Gentle rounded edges and tactile massing',
      'Soft tabletop studio global illumination',
    ],
    mediumKeywords: ['3D clay render', 'matte miniature maquette', 'physically based softbox 3D'],
    lightingKeywords: ['soft diffused studio softbox', 'creamy ambient occlusion', 'gentle rim fill'],
    defaultNegativeDirectives: [
      'flat 2D outlines',
      'mirror chrome glare',
      'gritty harsh realism',
      'sketchy ink hatching',
    ],
    recommendedAspectRatios: ['1:1', '4:3', '3:4'],
    visualCharacteristics:
      'Sculptural tactile solidity, velvety matte roughness, and clean studio tabletop shadow softness.',
    renderingTechnique:
      'Physically based 3D clay shader rendering with soft subsurface warmth and clean ambient occlusion.',
    renderingRules:
      'Physically based 3D clay shader rendering with soft subsurface warmth and clean ambient occlusion.',
    lineworkRules:
      'No drawn lines; silhouettes defined purely by soft chamfered 3D volume and studio light wrap.',
    colorRules:
      'Pastel mineral clay tones—warm terracotta, putty cream, muted periwinkle, and soft sage.',
    textureRules:
      'Smooth matte polymer clay with subtle micro-finger-smoothed warmth and soft satin roughness.',
    shadingRules:
      'Soft diffused three-point studio illumination with gentle contact shadows on seamless backdrop.',
    compositionRules:
      'Clean three-quarter tabletop maquette presentation with generous studio breathing room.',
    detailLevel: 'balanced',
    promptTemplate:
      'Tactile 3D clay render sculpted like a matte polymer maquette, featuring soft rounded edges, creamy ambient occlusion, and diffused tabletop studio lighting.',
    negativePromptTemplate:
      '2D ink outlines, mirror metallic reflections, noisy film grain, harsh hard shadows',
    tags: ['3d', 'clay', 'sculpture', 'matte', 'maquette', 'studio lighting'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'clay_sculpture',
      palette: ['#EDE8DF', '#D97B59', '#647C99', '#B8B0A2'],
      accentNote: 'Matte sculpted 3D clay maquette',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_chrome_future_11',
    slug: 'chrome-futurism',
    name: 'Chrome Futurism',
    category: 'digital_art',
    summary:
      'Sleek neo-futurist studio aesthetic blending liquid-metal specular chrome, anodized slate surfaces, and crisp cyan-amber rim reflections.',
    shortDescription:
      'Mirror-polished liquid chrome contours, precision studio reflections, and neo-futurist poise.',
    description:
      'Reimagines the subject through precision industrial futurism: brushed titanium and mirror chrome surfaces catch sculpted horizon reflections against clean dark-graphite studio space.',
    styleDirectives: [
      'Mirror-polished chrome and brushed titanium finishes',
      'Precision industrial surface reflections',
      'Clean neo-futurist dark studio atmosphere',
    ],
    mediumKeywords: ['chrome futurism digital art', 'sleek metallic 3D rendering', 'industrial specular study'],
    lightingKeywords: ['precision studio strip lights', 'cool silver and electric cobalt reflections'],
    defaultNegativeDirectives: [
      'rusty distressed grunge',
      'watercolor paper texture',
      'sketchy pencil lines',
      'flat matte clip art',
    ],
    recommendedAspectRatios: ['1:1', '16:9', '4:3'],
    visualCharacteristics:
      'High-contrast liquid chrome highlights, machined edge precision, and sleek dark studio depth.',
    renderingTechnique:
      'High-precision raytraced metallic digital rendering with controlled anisotropic reflections.',
    renderingRules:
      'High-precision raytraced metallic digital rendering with controlled anisotropic reflections.',
    lineworkRules:
      'Machined specular edge catches and crisp bevel highlights replacing drawn outlines.',
    colorRules:
      'Liquid silver, deep obsidian graphite, cool cobalt reflection ribbons, and subtle warm amber rim.',
    textureRules:
      'Mirror-smooth polished chrome contrasted with fine linear brushed-aluminum micro-anisotropy.',
    shadingRules:
      'Sharp studio light-bar reflections gliding cleanly over smooth sculptural curvature.',
    compositionRules:
      'Heroic industrial-design showcase angle floating cleanly over minimal dark gradient studio ground.',
    detailLevel: 'high',
    promptTemplate:
      'Sleek chrome futurism digital artwork with mirror-polished liquid metal surfaces, brushed titanium accents, and precision studio strip-light reflections.',
    negativePromptTemplate:
      'paper grain, watercolor wash, flat 2D cartoon lines, rusty dirt or matte chalk',
    tags: ['chrome', 'futurism', 'metallic', 'digital', 'specular', 'industrial'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'chrome_prism',
      palette: ['#13161E', '#D7E2F1', '#3B82F6', '#677489'],
      accentNote: 'Liquid chrome & specular edge light',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
  {
    id: 'sty_gothic_ornament_12',
    slug: 'gothic-ornamental',
    name: 'Gothic Ornamental',
    category: 'graphic_design',
    summary:
      'Cathedral-inspired ornamental graphic design weaving pointed tracery, dramatic gold-and-obsidian contrast, and intricate filigree poise.',
    shortDescription:
      'Architectural pointed tracery, intricate dark-and-gilt filigree, and ceremonial graphic drama.',
    description:
      'Combines medieval stone-tracery geometry with refined modern dark-editorial graphic craft—framing the subject within symmetrical pointed arches, botanical filigree accents, and luminous antique gilt highlights.',
    styleDirectives: [
      'Pointed cathedral tracery and symmetrical filigree',
      'Dramatic obsidian and antique gilt contrast',
      'Ceremonial print-plate precision',
    ],
    mediumKeywords: ['gothic ornamental graphic design', 'illuminated filigree print', 'dark editorial engraving'],
    lightingKeywords: ['dramatic chiaroscuro gilt sheen', 'velvety obsidian shadow depth'],
    defaultNegativeDirectives: [
      'bubbly pastel pop art',
      'minimalist flat vector icons',
      'plastic clay finish',
      'messy neon glitch',
    ],
    recommendedAspectRatios: ['3:4', '2:3', '1:1'],
    visualCharacteristics:
      'Ornate symmetrical tracery, crisp high-contrast dark inkwork, and warm metallic gold filigree accents.',
    renderingTechnique:
      'Precision ornamental graphic illustration uniting crisp dark plate linework with warm antique gilt accents.',
    renderingRules:
      'Precision ornamental graphic illustration uniting crisp dark plate linework with warm antique gilt accents.',
    lineworkRules:
      'Intricate symmetrical filigree curves, pointed trefoil arcs, and crisp fine-line architectural contours.',
    colorRules:
      'Deep raven obsidian, antique burnished gold, muted crimson garnet, and warm parchment highlights.',
    textureRules:
      'Velvety dark matte stock accented with fine metallic gold-leaf ink luminosity.',
    shadingRules:
      'Crisp chiaroscuro ink modeling paired with luminous gilded edge catches.',
    compositionRules:
      'Formal symmetrical ceremonial framing anchoring the subject inside subtle ornamental tracery borders.',
    detailLevel: 'intricate',
    promptTemplate:
      'Gothic ornamental graphic design featuring symmetrical cathedral tracery, intricate antique gold filigree accents, and dramatic obsidian chiaroscuro precision.',
    negativePromptTemplate:
      'pastel pop-art aesthetic, minimal flat clay, blurry low-res photography, modern neon glitch',
    tags: ['gothic', 'ornamental', 'filigree', 'gilt', 'cathedral', 'ceremonial'],
    previewAsset: {
      kind: 'editorial_svg',
      motif: 'gothic_rosette',
      palette: ['#18161B', '#C9A45A', '#7B2D3B', '#EAE1CE'],
      accentNote: 'Symmetrical tracery & antique gilt',
    },
    isActive: true,
    isCurated: true,
    version: 1,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  },
];

export const CURATED_ART_STYLES: readonly ArtStyle[] = Object.freeze(
  RAW_CURATED_ART_STYLES.map((style) => deepFreezeStyle({ ...style })),
);

export function cloneArtStyle(style: ArtStyle): ArtStyle {
  return {
    ...style,
    styleDirectives: [...style.styleDirectives],
    mediumKeywords: [...style.mediumKeywords],
    lightingKeywords: [...style.lightingKeywords],
    defaultNegativeDirectives: [...style.defaultNegativeDirectives],
    recommendedAspectRatios: [...style.recommendedAspectRatios],
    ...(style.tags ? { tags: [...style.tags] } : {}),
    ...(style.previewAsset
      ? {
          previewAsset: {
            ...style.previewAsset,
            palette: [...style.previewAsset.palette] as [string, string, string, string],
          },
        }
      : {}),
  };
}

export function getCuratedStyleByIdSync(styleId: EntityId): ArtStyle | null {
  const match = CURATED_ART_STYLES.find((s) => s.id === styleId);
  return match ? cloneArtStyle(match) : null;
}

export function formatArtStyleCategoryLabel(category: ArtStyleCategory | string): string {
  return (
    CURATED_STYLE_CATEGORY_LABELS[category] ??
    category
      .split('_')
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
      .join(' ')
  );
}

export function validateArtStyleRecord(style: unknown): ServiceResult<ArtStyle> {
  if (!isPlainRecord(style)) {
    return errResult('VALIDATION_ERROR', 'ArtStyle record must be a plain object.');
  }

  const credKey = findCredentialLeakKey(style, 'artStyles');
  if (credKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Credential-like field "${credKey}" is prohibited on ArtStyle records.`,
      { field: credKey },
    );
  }

  const imageKey = findForbiddenImageInput(style, 'artStyles');
  if (imageKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${imageKey.reason} ArtStyle catalog records must not store source images.`,
      { path: imageKey.path },
    );
  }

  if (!isValidEntityId(style.id)) {
    return errResult('VALIDATION_ERROR', 'ArtStyle record requires a valid entity id.');
  }

  if (!isNonEmptyString(style.slug) || !isNonEmptyString(style.name)) {
    return errResult('VALIDATION_ERROR', 'ArtStyle record requires non-empty slug and name.');
  }

  if (!isNonEmptyString(style.category)) {
    return errResult('VALIDATION_ERROR', 'ArtStyle record requires a valid category.');
  }

  if (!isNonEmptyString(style.summary)) {
    return errResult('VALIDATION_ERROR', 'ArtStyle record requires a non-empty summary.');
  }

  if (!isValidIsoTimestamp(style.createdAt) || !isValidIsoTimestamp(style.updatedAt)) {
    return errResult(
      'VALIDATION_ERROR',
      'ArtStyle record requires valid ISO-8601 timestamps.',
    );
  }

  if (
    style.detailLevel !== undefined &&
    (typeof style.detailLevel !== 'string' ||
      !ALLOWED_DETAIL_LEVELS.has(style.detailLevel as PromptDetailLevel))
  ) {
    return errResult('VALIDATION_ERROR', 'ArtStyle detailLevel must be valid.');
  }

  return okResult(style as unknown as ArtStyle);
}

export function filterAndSortStyleCatalog(
  items: readonly StyleCatalogItem[],
  options: StyleQueryOptions = {},
): readonly StyleCatalogItem[] {
  const query = (options.search ?? '').trim().toLowerCase();
  const category = options.category ?? 'all';
  const favoritesOnly = options.favoritesOnly === true;
  const sortBy: StyleSortOption = options.sortBy ?? 'curated_order';

  const catalogOrderMap = new Map<string, number>();
  CURATED_ART_STYLES.forEach((style, index) => {
    catalogOrderMap.set(style.id, index);
  });

  const filtered = items.filter(({ style, isFavorite }) => {
    if (style.isActive === false) {
      return false;
    }
    if (favoritesOnly && !isFavorite) {
      return false;
    }
    if (category !== 'all' && style.category !== category) {
      return false;
    }
    if (!query) {
      return true;
    }

    const haystack = [
      style.name,
      style.category,
      formatArtStyleCategoryLabel(style.category),
      style.summary,
      style.shortDescription ?? '',
      style.description ?? '',
      style.visualCharacteristics ?? '',
      style.renderingTechnique ?? style.renderingRules ?? '',
      ...(style.tags ?? []),
      ...style.styleDirectives,
      ...style.mediumKeywords,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name_asc') {
      return a.style.name.localeCompare(b.style.name);
    }
    if (sortBy === 'name_desc') {
      return b.style.name.localeCompare(a.style.name);
    }
    if (sortBy === 'favorites_first') {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }
    }
    const orderA = catalogOrderMap.get(a.style.id) ?? Number.MAX_SAFE_INTEGER;
    const orderB = catalogOrderMap.get(b.style.id) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.style.name.localeCompare(b.style.name);
  });

  return sorted;
}

export function computeStyleCategoryCounts(
  items: readonly StyleCatalogItem[],
  favoritesOnly = false,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {
    all: 0,
  };
  for (const meta of CURATED_STYLE_CATEGORIES) {
    if (meta.id !== 'all') {
      counts[meta.id] = 0;
    }
  }

  for (const item of items) {
    if (item.style.isActive === false) {
      continue;
    }
    if (favoritesOnly && !item.isFavorite) {
      continue;
    }
    counts.all = (counts.all ?? 0) + 1;
    counts[item.style.category] = (counts[item.style.category] ?? 0) + 1;
  }

  return counts;
}
