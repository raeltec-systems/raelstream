import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import sharp, { type Metadata } from 'sharp';
import type { DB } from './db.js';
import { AppError } from './errors.js';

export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const ASSET_MAX_SIDE = 4096;

export interface StoredAsset {
  id: string;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
}

/** Magic bytes: the declared type is never trusted (SPEC §10.6). */
export function sniff(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

/**
 * Validate and normalise an uploaded image: sniff the type, fully decode it, refuse animations and
 * oversize images, then re-encode (strips metadata, applies EXIF orientation, converts to sRGB).
 * PNG when the image has transparency (logos), otherwise JPEG quality 90.
 */
export async function normaliseImage(
  input: Buffer,
): Promise<{ data: Buffer; mime: StoredAsset['mime']; width: number; height: number }> {
  if (input.length > ASSET_MAX_BYTES) throw new AppError('ASSET_TOO_LARGE');
  if (!sniff(input)) throw new AppError('ASSET_UNSUPPORTED');
  let meta: Metadata;
  try {
    meta = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    throw new AppError('ASSET_CORRUPT');
  }
  if ((meta.pages ?? 1) > 1) throw new AppError('ASSET_UNSUPPORTED'); // animated PNG/WebP
  if (!meta.width || !meta.height) throw new AppError('ASSET_CORRUPT');
  if (meta.width > ASSET_MAX_SIDE || meta.height > ASSET_MAX_SIDE)
    throw new AppError('ASSET_TOO_LARGE');
  try {
    const img = sharp(input, { failOn: 'error' }).rotate().toColourspace('srgb');
    const alpha = meta.hasAlpha === true;
    const { data, info } = await (
      alpha ? img.png() : img.jpeg({ quality: 90, mozjpeg: true })
    ).toBuffer({ resolveWithObject: true });
    return {
      data,
      mime: alpha ? 'image/png' : 'image/jpeg',
      width: info.width,
      height: info.height,
    };
  } catch {
    throw new AppError('ASSET_CORRUPT');
  }
}

export async function storeAsset(
  db: Kysely<DB>,
  input: Buffer,
  userId: string | null,
): Promise<StoredAsset> {
  const img = await normaliseImage(input);
  const sha256 = createHash('sha256').update(img.data).digest();
  const existing = await db
    .selectFrom('assets')
    .select(['id', 'mime', 'width', 'height', 'bytes'])
    .where('sha256', '=', sha256)
    .executeTakeFirst();
  if (existing) return existing;
  return db
    .insertInto('assets')
    .values({
      sha256,
      mime: img.mime,
      width: img.width,
      height: img.height,
      bytes: img.data.length,
      data: img.data,
      created_by: userId,
    })
    .returning(['id', 'mime', 'width', 'height', 'bytes'])
    .executeTakeFirstOrThrow();
}
