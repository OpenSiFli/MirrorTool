import { z } from "zod";

import type { AssetTransform, MirrorConfig, PlannerMode, RepoConfig, SyncTask } from "./types.ts";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const NonEmptyStringSchema = z.string().refine((value) => value.trim() !== "", {
  message: "must be a non-empty string",
});

const RawAssetTransformSchema = z.object({
  sourceName: NonEmptyStringSchema,
  targetName: NonEmptyStringSchema,
  format: z.unknown().optional().default("zip"),
  removeSource: z.boolean().optional().default(true),
});

const RawAssetTransformsSchema = z.array(RawAssetTransformSchema).nullish().transform((value) => value ?? []);
const RawAssetNamesSchema = z.array(NonEmptyStringSchema).nullish().transform((value) => value ?? null);

const RawRepoConfigSchema = z.object({
  owner: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  manualTags: z.array(NonEmptyStringSchema),
  syncedTags: z.array(NonEmptyStringSchema),
  flushUrl: NonEmptyStringSchema.nullish().transform((value) => value ?? null),
  assetNames: RawAssetNamesSchema,
  assetTransforms: RawAssetTransformsSchema,
});

const RawMirrorConfigSchema = z.object({
  version: z.literal(1),
  repos: z.array(RawRepoConfigSchema),
});

const RawSyncTaskSchema = z.object({
  owner: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  tag: NonEmptyStringSchema,
  flushUrl: NonEmptyStringSchema.nullish().transform((value) => value ?? null),
  assetNames: RawAssetNamesSchema,
  assetTransforms: RawAssetTransformsSchema,
  reason: z.literal("manual"),
});

const RawSyncTasksSchema = z.array(RawSyncTaskSchema);

export const PlannerModeSchema = z.enum(["push", "workflow_dispatch"]);

type NormalizeOptions = {
  sort?: boolean;
};

type RawRepoConfig = z.infer<typeof RawRepoConfigSchema>;
type RawSyncTask = z.infer<typeof RawSyncTaskSchema>;

export function normalizeConfig(input: unknown): MirrorConfig {
  return withValidationError(() => {
    const parsed = RawMirrorConfigSchema.parse(input);
    const seenRepos = new Set<string>();
    const repos = parsed.repos.map((repo, index) => normalizeRepo(repo, index, seenRepos));

    return {
      version: 1,
      repos: repos.sort(compareRepos),
    };
  });
}

export function normalizeSyncTasks(input: unknown): SyncTask[] {
  return withValidationError(() => RawSyncTasksSchema.parse(input).map(normalizeSyncTask));
}

export function normalizePlannerMode(input: unknown): PlannerMode {
  return withValidationError(() => PlannerModeSchema.parse(input));
}

export function normalizeAssetNames(
  input: unknown,
  fieldName = "assetNames",
  options: NormalizeOptions = {},
): string[] | null {
  return withValidationError(() => {
    const parsed = RawAssetNamesSchema.parse(input);
    if (parsed === null) {
      return null;
    }

    ensureUnique(parsed, fieldName);
    return options.sort ? [...parsed].sort() : parsed;
  });
}

export function normalizeAssetTransforms(
  input: unknown,
  fieldName = "assetTransforms",
  options: NormalizeOptions = {},
): AssetTransform[] {
  return withValidationError(() => {
    const parsed = RawAssetTransformsSchema.parse(input);
    const seenTargets = new Set<string>();
    const transforms = parsed.map<AssetTransform>((entry, index) => {
      if (entry.format !== "zip") {
        throw new ValidationError(`${fieldName}[${index}].format must be "zip"`);
      }
      if (entry.sourceName === entry.targetName) {
        throw new ValidationError(`${fieldName}[${index}].targetName must differ from sourceName`);
      }
      if (seenTargets.has(entry.targetName)) {
        throw new ValidationError(`Duplicate transformed target in ${fieldName}: ${entry.targetName}`);
      }
      seenTargets.add(entry.targetName);

      return {
        sourceName: entry.sourceName,
        targetName: entry.targetName,
        format: "zip",
        removeSource: entry.removeSource,
      };
    });

    return options.sort ? transforms.sort(compareAssetTransforms) : transforms;
  });
}

function normalizeRepo(input: RawRepoConfig, index: number, seenRepos: Set<string>): RepoConfig {
  const repoKey = `${input.owner}/${input.repo}`;
  if (seenRepos.has(repoKey)) {
    throw new ValidationError(`Duplicate repository entry: ${repoKey}`);
  }
  seenRepos.add(repoKey);

  return {
    owner: input.owner,
    repo: input.repo,
    manualTags: normalizeStringArray(input.manualTags, `repos[${index}].manualTags`, { sort: true }),
    syncedTags: normalizeStringArray(input.syncedTags, `repos[${index}].syncedTags`, { sort: true }),
    flushUrl: input.flushUrl,
    assetNames: normalizeAssetNames(input.assetNames, `repos[${index}].assetNames`, { sort: true }),
    assetTransforms: normalizeAssetTransforms(input.assetTransforms, `repos[${index}].assetTransforms`, { sort: true }),
  };
}

function normalizeSyncTask(input: RawSyncTask, index: number): SyncTask {
  return {
    owner: input.owner,
    repo: input.repo,
    tag: input.tag,
    flushUrl: input.flushUrl,
    assetNames: normalizeAssetNames(input.assetNames, `tasks[${index}].assetNames`),
    assetTransforms: normalizeAssetTransforms(input.assetTransforms, `tasks[${index}].assetTransforms`),
    reason: input.reason,
  };
}

function normalizeStringArray(input: string[], fieldName: string, options: NormalizeOptions = {}): string[] {
  ensureUnique(input, fieldName);
  return options.sort ? [...input].sort() : input;
}

function ensureUnique(values: readonly string[], fieldName: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new ValidationError(`Duplicate value in ${fieldName}: ${value}`);
    }
    seen.add(value);
  }
}

function compareRepos(left: RepoConfig, right: RepoConfig): number {
  return `${left.owner}/${left.repo}`.localeCompare(`${right.owner}/${right.repo}`);
}

function compareAssetTransforms(left: AssetTransform, right: AssetTransform): number {
  return `${left.sourceName}/${left.targetName}`.localeCompare(`${right.sourceName}/${right.targetName}`);
}

function withValidationError<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    if (error instanceof z.ZodError) {
      throw new ValidationError(formatZodError(error));
    }
    throw error;
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => {
    const path = formatPath(issue.path);
    return path ? `${path}: ${issue.message}` : issue.message;
  }).join("; ");
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }
    return result ? `${result}.${String(segment)}` : String(segment);
  }, "");
}
