import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project, PromptDocument, SourceAsset } from '../../types/domain';
import {
  computeProjectWorkflowStage,
  filterProjectSummaries,
  inferRestorableProjectStatus,
  sortProjectSummaries,
  validateProjectTitle,
  type ProjectSummary,
} from './projectManagement';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? 'prj_test0001',
    title: overrides.title ?? 'Ceramic Vase Study',
    description: overrides.description ?? '',
    status: overrides.status ?? 'draft',
    previousStatus: overrides.previousStatus ?? null,
    sourceAssetId: overrides.sourceAssetId ?? null,
    activeAnalysisId: overrides.activeAnalysisId ?? null,
    activeDescriptionId: overrides.activeDescriptionId ?? null,
    selectedStyleId: overrides.selectedStyleId ?? null,
    activePromptId: overrides.activePromptId ?? null,
    activeGenerationJobId: overrides.activeGenerationJobId ?? null,
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? '2026-11-10T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-11-10T10:00:00.000Z',
  };
}

function makeSummary(
  project: Project,
  overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
  return {
    project,
    sourceAsset: overrides.sourceAsset ?? null,
    sourceAvailability: overrides.sourceAvailability ?? 'none',
    artworkCount: overrides.artworkCount ?? 0,
    generationJobCount: overrides.generationJobCount ?? 0,
    analysisCount: overrides.analysisCount ?? 0,
    descriptionCount: overrides.descriptionCount ?? 0,
    promptCount: overrides.promptCount ?? 0,
    latestArtwork: overrides.latestArtwork ?? null,
    latestArtworkBlob: overrides.latestArtworkBlob ?? null,
    sourcePreviewBlob: overrides.sourcePreviewBlob ?? null,
    workflowStage: overrides.workflowStage ?? 'draft',
    workflowStageLabel: overrides.workflowStageLabel ?? 'Draft Study',
    isActiveProject: overrides.isActiveProject ?? false,
  };
}

test('validateProjectTitle rejects empty/whitespace titles and trims valid input', () => {
  const empty = validateProjectTitle('   ');
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.equal(empty.error.code, 'VALIDATION_ERROR');
  }

  const tooLong = validateProjectTitle('x'.repeat(121));
  assert.equal(tooLong.ok, false);

  const valid = validateProjectTitle('  Porcelain Bottle  ');
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.data, 'Porcelain Bottle');
  }
});

test('filterProjectSummaries supports case-insensitive search and All/Active/Archived tabs', () => {
  const summaries: ProjectSummary[] = [
    makeSummary(makeProject({ id: 'prj_001', title: 'Terracotta Vessel', status: 'generated' })),
    makeSummary(makeProject({ id: 'prj_002', title: 'Glass Decanter', status: 'archived' })),
    makeSummary(makeProject({ id: 'prj_003', title: 'Botanical Vase Study', status: 'draft' })),
  ];

  assert.equal(
    filterProjectSummaries(summaries, { searchQuery: '', filter: 'all' }).length,
    3,
  );
  assert.deepEqual(
    filterProjectSummaries(summaries, { searchQuery: '', filter: 'active' }).map(
      (s) => s.project.id,
    ),
    ['prj_001', 'prj_003'],
  );
  assert.deepEqual(
    filterProjectSummaries(summaries, { searchQuery: '', filter: 'archived' }).map(
      (s) => s.project.id,
    ),
    ['prj_002'],
  );
  assert.deepEqual(
    filterProjectSummaries(summaries, { searchQuery: '  VASE ', filter: 'all' }).map(
      (s) => s.project.id,
    ),
    ['prj_003'],
  );
  assert.deepEqual(
    filterProjectSummaries(summaries, { searchQuery: 'vessel', filter: 'archived' }),
    [],
  );
});

test('sortProjectSummaries handles updated_desc, created_desc, name_asc, and name_desc', () => {
  const summaries: ProjectSummary[] = [
    makeSummary(
      makeProject({
        id: 'prj_a',
        title: 'Zephyr Lamp',
        createdAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-15T10:00:00.000Z',
      }),
    ),
    makeSummary(
      makeProject({
        id: 'prj_b',
        title: 'Amber Bowl',
        createdAt: '2026-11-12T10:00:00.000Z',
        updatedAt: '2026-11-12T10:00:00.000Z',
      }),
    ),
    makeSummary(
      makeProject({
        id: 'prj_c',
        title: 'Cobalt Jug',
        createdAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-14T10:00:00.000Z',
      }),
    ),
  ];

  assert.deepEqual(
    sortProjectSummaries(summaries, 'updated_desc').map((s) => s.project.id),
    ['prj_a', 'prj_c', 'prj_b'],
  );
  assert.deepEqual(
    sortProjectSummaries(summaries, 'created_desc').map((s) => s.project.id),
    ['prj_b', 'prj_c', 'prj_a'],
  );
  assert.deepEqual(
    sortProjectSummaries(summaries, 'name_asc').map((s) => s.project.id),
    ['prj_b', 'prj_c', 'prj_a'],
  );
  assert.deepEqual(
    sortProjectSummaries(summaries, 'name_desc').map((s) => s.project.id),
    ['prj_a', 'prj_c', 'prj_b'],
  );
});

test('inferRestorableProjectStatus prefers explicit previousStatus and otherwise infers from persisted relationships', () => {
  const withExplicit = makeProject({
    status: 'archived',
    previousStatus: 'prompt_ready',
  });
  assert.equal(
    inferRestorableProjectStatus({ project: withExplicit }),
    'prompt_ready',
  );

  const legacyWithArtwork = makeProject({
    status: 'archived',
    previousStatus: null,
  });
  assert.equal(
    inferRestorableProjectStatus({ project: legacyWithArtwork, artworkCount: 2 }),
    'generated',
  );

  const legacyAnalyzed = makeProject({
    status: 'archived',
    previousStatus: null,
    activeAnalysisId: 'anl_001',
  });
  assert.equal(
    inferRestorableProjectStatus({ project: legacyAnalyzed }),
    'analyzed',
  );

  const legacyDraft = makeProject({ status: 'archived', previousStatus: null });
  assert.equal(inferRestorableProjectStatus({ project: legacyDraft }), 'draft');
});

test('computeProjectWorkflowStage accurately reflects real workflow progression', () => {
  const sourceAsset: SourceAsset = {
    id: 'ast_1',
    projectId: 'prj_1',
    originalFileName: 'vase.png',
    mimeType: 'image/png',
    fileExtension: 'png',
    fileSizeBytes: 1024,
    width: 512,
    height: 512,
    aspectRatio: { widthRatio: 1, heightRatio: 1, label: '1:1', numeric: 1 },
    localBlobKey: 'blb_1',
    validationStatus: 'validated',
    storageStatus: 'persisted',
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  };

  const approvedPrompt = {
    id: 'prm_1',
    approvalStatus: 'approved',
  } as unknown as PromptDocument;

  const project = makeProject({ id: 'prj_1', sourceAssetId: 'ast_1' });

  assert.equal(
    computeProjectWorkflowStage({
      project,
      sourceAsset: null,
      analysisCount: 0,
      descriptionCount: 0,
      latestPrompt: null,
      promptCount: 0,
      artworkCount: 0,
    }).workflowStageLabel,
    'Source Image Ready',
  );

  assert.equal(
    computeProjectWorkflowStage({
      project,
      sourceAsset,
      analysisCount: 1,
      descriptionCount: 1,
      latestPrompt: approvedPrompt,
      promptCount: 1,
      artworkCount: 0,
    }).workflowStageLabel,
    'Prompt Approved',
  );

  assert.equal(
    computeProjectWorkflowStage({
      project,
      sourceAsset,
      analysisCount: 1,
      descriptionCount: 1,
      latestPrompt: approvedPrompt,
      promptCount: 1,
      artworkCount: 3,
    }).workflowStageLabel,
    'Artwork Generated',
  );
});
