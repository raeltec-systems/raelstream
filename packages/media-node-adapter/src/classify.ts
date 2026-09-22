/**
 * Destination error classification from redacted FFmpeg stderr (SPEC §12.4). Auth and media refusals
 * are not retried as network glitches (B§17.1). The table grows from real rejections in WP4.
 */
export type PublishFailure = 'DEST_AUTH_REJECTED' | 'DEST_MEDIA_REJECTED' | 'DEST_NETWORK';

const AUTH = [
  /\b401\b/,
  /\b403\b/,
  /unauthori[sz]ed/i,
  /forbidden/i,
  /NetStream\.Publish\.BadName/i,
  /publish(ing)? (is )?not allowed/i,
  /authentication/i,
];
const MEDIA = [
  /Invalid data found/i,
  /codec not currently supported/i,
  /Could not write header/i,
  /incorrect codec parameters/i,
  /unsupported codec/i,
];
const NETWORK = [
  /Connection refused/i,
  /timed out/i,
  /Connection reset/i,
  /Broken pipe/i,
  /Network is unreachable/i,
  /Input\/output error/i,
  /End of file/i,
  /Name or service not known/i,
  /Temporary failure in name resolution/i,
];

export function classifyPublisherError(stderr: string): PublishFailure {
  if (AUTH.some((r) => r.test(stderr))) return 'DEST_AUTH_REJECTED';
  if (NETWORK.some((r) => r.test(stderr))) return 'DEST_NETWORK';
  if (MEDIA.some((r) => r.test(stderr))) return 'DEST_MEDIA_REJECTED';
  return 'DEST_NETWORK';
}

export function isRetryable(f: PublishFailure): boolean {
  return f === 'DEST_NETWORK';
}

/** Redact stream keys and credentials in any text before it is logged or stored (B§23.2). */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[REDACTED]');
  return out
    .replace(/(rtmps?:\/\/[^\s'"]+?\/[^\s'"/]+\/)[^\s'"]+/gi, '$1[REDACTED]')
    .replace(/(rtsps?:\/\/)[^\s'"@/]+@/gi, '$1[REDACTED]@');
}
