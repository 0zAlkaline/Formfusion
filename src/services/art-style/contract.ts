import { errResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type { ArtStyle, StyleCatalogItem } from '../../types/domain.ts';
import type { ArtStyleService, StyleQueryOptions } from '../../types/services.ts';

export class ArtStyleServiceFoundation implements ArtStyleService {
  async ensureCatalogSeeded(): Promise<ServiceResult<readonly ArtStyle[]>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'Curated Style Library population is not enabled on foundation stub.',
    );
  }

  async listStyles(
    _options?: StyleQueryOptions,
  ): Promise<ServiceResult<readonly ArtStyle[]>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'Curated Style Library population is deferred beyond Phase 01.1.',
    );
  }

  async listCatalogWithFavorites(
    _options?: StyleQueryOptions,
  ): Promise<ServiceResult<readonly StyleCatalogItem[]>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'Curated Style Library catalog is not enabled on foundation stub.',
    );
  }

  async getStyleById(
    _styleId: EntityId,
  ): Promise<ServiceResult<ArtStyle | null>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'Curated Style Library lookup is deferred beyond Phase 01.1.',
    );
  }

  async listFavoriteStyleIds(): Promise<ServiceResult<readonly EntityId[]>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'Curated Style Library favorites are not enabled on foundation stub.',
    );
  }

  async toggleFavoriteStyle(
    _styleId: EntityId,
  ): Promise<ServiceResult<boolean>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'Curated Style Library favorites are not enabled on foundation stub.',
    );
  }

  validateStyle(_style: unknown): ServiceResult<ArtStyle> {
    return errResult(
      'NOT_IMPLEMENTED',
      'ArtStyle validation rules are deferred beyond Phase 01.1.',
    );
  }
}

export {
  CURATED_ART_STYLES,
  CURATED_STYLE_CATEGORIES,
  CURATED_STYLE_CATEGORY_LABELS,
  cloneArtStyle,
  computeStyleCategoryCounts,
  filterAndSortStyleCatalog,
  formatArtStyleCategoryLabel,
  getCuratedStyleByIdSync,
  validateArtStyleRecord,
} from './curatedCatalog.ts';

export { StudioArtStyleService, buildFavoriteRecordId } from './artStyleService.ts';

export type { ArtStyleService };
