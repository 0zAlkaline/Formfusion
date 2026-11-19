import { okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type {
  ArtStyle,
  StyleCatalogItem,
  StyleFavoriteRecord,
} from '../../types/domain.ts';
import type { ArtStyleService, StyleQueryOptions } from '../../types/services.ts';
import type { IndexedDbStorageGateway } from '../../types/storage.ts';
import { nowIsoTimestamp } from '../../utils/ids.ts';
import {
  CURATED_ART_STYLES,
  cloneArtStyle,
  filterAndSortStyleCatalog,
  validateArtStyleRecord,
} from './curatedCatalog.ts';

export function buildFavoriteRecordId(styleId: EntityId): EntityId {
  return `fav_${styleId}`;
}

export class StudioArtStyleService implements ArtStyleService {
  private readonly gateway: IndexedDbStorageGateway;
  private seedPromise: Promise<ServiceResult<readonly ArtStyle[]>> | null = null;

  constructor(gateway: IndexedDbStorageGateway) {
    this.gateway = gateway;
  }

  async ensureCatalogSeeded(): Promise<ServiceResult<readonly ArtStyle[]>> {
    if (!this.gateway.isAvailable()) {
      return okResult(CURATED_ART_STYLES.map((style) => cloneArtStyle(style)));
    }

    if (this.seedPromise) {
      return this.seedPromise;
    }

    this.seedPromise = this.performIdempotentSeed().finally(() => {
      this.seedPromise = null;
    });

    return this.seedPromise;
  }

  private async performIdempotentSeed(): Promise<ServiceResult<readonly ArtStyle[]>> {
    const store = this.gateway.getStore('artStyles');
    const existingRes = await store.listAll();
    if (!existingRes.ok) {
      return existingRes;
    }

    const existingById = new Map<EntityId, ArtStyle>();
    const existingBySlug = new Map<string, ArtStyle>();
    for (const row of existingRes.data) {
      existingById.set(row.id, row);
      existingBySlug.set(row.slug, row);
    }

    for (const curated of CURATED_ART_STYLES) {
      const canonical = cloneArtStyle(curated);
      const existing =
        existingById.get(canonical.id) ?? existingBySlug.get(canonical.slug);
      if (
        !existing ||
        existing.version !== canonical.version ||
        !existing.previewAsset ||
        !existing.tags
      ) {
        const putRes = await store.put(canonical);
        if (!putRes.ok) {
          return putRes;
        }
        existingById.set(canonical.id, canonical);
      }
    }

    const refreshedRes = await store.listAll();
    if (!refreshedRes.ok) {
      return refreshedRes;
    }

    const curatedOrder = new Map<string, number>();
    CURATED_ART_STYLES.forEach((item, idx) => curatedOrder.set(item.id, idx));
    const ordered = [...refreshedRes.data].sort((a, b) => {
      const idxA = curatedOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const idxB = curatedOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (idxA !== idxB) {
        return idxA - idxB;
      }
      return a.name.localeCompare(b.name);
    });

    return okResult(ordered);
  }

  async listFavoriteStyleIds(): Promise<ServiceResult<readonly EntityId[]>> {
    if (!this.gateway.isAvailable()) {
      return okResult([]);
    }

    const favRes = await this.gateway.getStore('styleFavorites').listAll();
    if (!favRes.ok) {
      return favRes;
    }

    const uniqueIds = Array.from(
      new Set(
        favRes.data
          .filter((record) => record.isFavorite)
          .map((record) => record.styleId),
      ),
    );
    return okResult(uniqueIds);
  }

  async toggleFavoriteStyle(
    styleId: EntityId,
  ): Promise<ServiceResult<boolean>> {
    const styleRes = await this.getStyleById(styleId);
    if (!styleRes.ok) {
      return styleRes;
    }
    if (!styleRes.data) {
      return {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: `Art style "${styleId}" could not be found.`,
        },
      };
    }

    const favStore = this.gateway.getStore('styleFavorites');
    const existingRes = await favStore.listAll();
    if (!existingRes.ok) {
      return existingRes;
    }

    const matchingRecords = existingRes.data.filter(
      (record) => record.styleId === styleId,
    );
    const currentlyFavorited = matchingRecords.some((record) => record.isFavorite);
    const nextFavorited = !currentlyFavorited;

    for (const stale of matchingRecords) {
      if (stale.id !== buildFavoriteRecordId(styleId)) {
        await favStore.delete(stale.id);
      }
    }

    const recordId = buildFavoriteRecordId(styleId);
    if (!nextFavorited) {
      const delRes = await favStore.delete(recordId);
      if (!delRes.ok) {
        return delRes;
      }
      return okResult(false);
    }

    const now = nowIsoTimestamp();
    const existingCanonical = matchingRecords.find((r) => r.id === recordId);
    const favRecord: StyleFavoriteRecord = {
      id: recordId,
      styleId,
      isFavorite: true,
      createdAt: existingCanonical?.createdAt ?? now,
      updatedAt: now,
    };

    const putRes = await favStore.put(favRecord);
    if (!putRes.ok) {
      return putRes;
    }

    return okResult(true);
  }

  async listCatalogWithFavorites(
    options: StyleQueryOptions = {},
  ): Promise<ServiceResult<readonly StyleCatalogItem[]>> {
    const seededRes = await this.ensureCatalogSeeded();
    if (!seededRes.ok) {
      return seededRes;
    }

    const favRes = await this.listFavoriteStyleIds();
    if (!favRes.ok) {
      return favRes;
    }

    const favSet = new Set<EntityId>(favRes.data);
    const items: StyleCatalogItem[] = seededRes.data.map((style) => ({
      style,
      isFavorite: favSet.has(style.id),
    }));

    return okResult(filterAndSortStyleCatalog(items, options));
  }

  async listStyles(
    options: StyleQueryOptions = {},
  ): Promise<ServiceResult<readonly ArtStyle[]>> {
    const catalogRes = await this.listCatalogWithFavorites(options);
    if (!catalogRes.ok) {
      return catalogRes;
    }
    return okResult(catalogRes.data.map((item) => item.style));
  }

  async getStyleById(
    styleId: EntityId,
  ): Promise<ServiceResult<ArtStyle | null>> {
    const seededRes = await this.ensureCatalogSeeded();
    if (!seededRes.ok) {
      return seededRes;
    }

    const match = seededRes.data.find((style) => style.id === styleId) ?? null;
    return okResult(match);
  }

  validateStyle(style: unknown): ServiceResult<ArtStyle> {
    return validateArtStyleRecord(style);
  }
}
