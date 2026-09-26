import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { DB } from './db.js';
import { AppError } from './errors.js';

/** Rundown items as stored on the server (SPEC §10.3). Images reference an uploaded asset (§10.6). */
export const RundownItem = z.discriminatedUnion('type', [
  z.object({
    id: z.string().uuid(),
    type: z.literal('lower_third'),
    title: z.string().max(60),
    line1: z.string().max(64),
    line2: z.string().max(64),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('text'),
    title: z.string().max(80),
    detail: z.string().max(600),
    reference: z.string().max(60).optional(),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('image'),
    title: z.string().max(60),
    fit: z.enum(['contain', 'fill']),
    assetId: z.string().uuid().nullable().optional(),
  }),
]);
export const Rundown = z.array(RundownItem).max(40);

export const AudioSettings = z.object({
  deviceLabel: z.string().max(200).nullable().optional(),
  mode: z.enum(['in1_both', 'in2_both', 'stereo_12', 'mono_blend']).optional(),
  gainDb: z.number().min(-24).max(12).optional(),
  hpf: z.boolean().optional(),
  compressor: z.boolean().optional(),
  delayMs: z.number().int().min(0).max(2000).optional(),
});

export const PresetInput = z.object({
  name: z.string().trim().min(1).max(80),
  profilePreference: z.enum(['reliable_hd', 'full_hd']).optional(),
  destinationIds: z.array(z.string().uuid()).max(2).optional(),
  fallbackGraceS: z.number().int().min(60).max(600).optional(),
  rundown: Rundown.optional(),
  audioDefaults: AudioSettings.optional(),
});

function toApi(r: {
  id: string;
  name: string;
  profile_preference: string;
  destination_ids: string[];
  fallback_grace_s: number;
  rundown: unknown[];
  audio_defaults: Record<string, unknown>;
  updated_at: Date;
}) {
  return {
    id: r.id,
    name: r.name,
    profilePreference: r.profile_preference,
    destinationIds: r.destination_ids,
    fallbackGraceS: r.fallback_grace_s,
    rundown: r.rundown,
    audioDefaults: r.audio_defaults,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listPresets(db: Kysely<DB>) {
  const rows = await db
    .selectFrom('presets')
    .selectAll()
    .where('archived_at', 'is', null)
    .orderBy('updated_at', 'desc')
    .execute();
  return rows.map(toApi);
}

export async function createPreset(
  db: Kysely<DB>,
  userId: string,
  input: z.infer<typeof PresetInput>,
) {
  const r = await db
    .insertInto('presets')
    .values({
      name: input.name,
      created_by: userId,
      updated_at: new Date(),
      ...(input.profilePreference ? { profile_preference: input.profilePreference } : {}),
      ...(input.destinationIds ? { destination_ids: input.destinationIds } : {}),
      ...(input.fallbackGraceS ? { fallback_grace_s: input.fallbackGraceS } : {}),
      ...(input.rundown ? { rundown: JSON.stringify(input.rundown) } : {}),
      ...(input.audioDefaults ? { audio_defaults: JSON.stringify(input.audioDefaults) } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toApi(r);
}

export async function updatePreset(
  db: Kysely<DB>,
  id: string,
  input: Partial<z.infer<typeof PresetInput>>,
) {
  const r = await db
    .updateTable('presets')
    .set({
      updated_at: new Date(),
      ...(input.name ? { name: input.name } : {}),
      ...(input.profilePreference ? { profile_preference: input.profilePreference } : {}),
      ...(input.destinationIds ? { destination_ids: input.destinationIds } : {}),
      ...(input.fallbackGraceS ? { fallback_grace_s: input.fallbackGraceS } : {}),
      ...(input.rundown ? { rundown: JSON.stringify(input.rundown) } : {}),
      ...(input.audioDefaults ? { audio_defaults: JSON.stringify(input.audioDefaults) } : {}),
    })
    .where('id', '=', id)
    .where('archived_at', 'is', null)
    .returningAll()
    .executeTakeFirst();
  if (!r) throw new AppError('NOT_FOUND', 'session');
  return toApi(r);
}

export async function archivePreset(db: Kysely<DB>, id: string) {
  await db.updateTable('presets').set({ archived_at: new Date() }).where('id', '=', id).execute();
}
