import { describe, expect, it } from 'vitest';
import { mapCaptureError, videoConstraints } from './sender.js';

describe('camera capture', () => {
  it('never requests audio (CAM-02)', () => {
    expect(videoConstraints({ width: 1920, height: 1080, fps: 30 }).audio).toBe(false);
  });
  it('prefers the rear camera unless a device is chosen', () => {
    const v = videoConstraints({ width: 1920, height: 1080, fps: 30 })
      .video as MediaTrackConstraints;
    expect(v.facingMode).toEqual({ ideal: 'environment' });
    const d = videoConstraints({ width: 1280, height: 720, fps: 30 }, 'abc')
      .video as MediaTrackConstraints;
    expect(d.deviceId).toEqual({ exact: 'abc' });
  });
  it('maps capture errors to plain codes (CAM-04)', () => {
    expect(mapCaptureError({ name: 'NotAllowedError' })).toBe('CAM_PERMISSION_DENIED');
    expect(mapCaptureError({ name: 'NotReadableError' })).toBe('CAM_IN_USE');
    expect(mapCaptureError({ name: 'NotFoundError' })).toBe('CAM_NOT_FOUND');
    expect(mapCaptureError(new Error('x'))).toBe('CAM_UNSUPPORTED');
  });
});
