import { StudioExportService } from './artworkExportService.ts';
import type {
  ArtworkSourceExportInspection,
  ExportArtifact,
  ExportArtworkRequest,
  ExportService,
} from '../../types/services.ts';

export class ExportServiceFoundation extends StudioExportService {}

export { StudioExportService };
export type {
  ArtworkSourceExportInspection,
  ExportArtifact,
  ExportArtworkRequest,
  ExportService,
};
