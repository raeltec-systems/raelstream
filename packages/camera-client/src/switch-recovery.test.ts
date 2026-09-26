import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraSender } from './sender.js';

afterEach(() => vi.unstubAllGlobals());
describe('camera replacement', () => {
  it.each([true, false])(
    'keeps capture consistent when replaceTrack rejects=%s',
    async (reject) => {
      const oldTrack = { stop: vi.fn() };
      const newTrack = {
        stop: vi.fn(),
        addEventListener: vi.fn(),
        getSettings: () => ({ deviceId: 'new' }),
        label: 'new',
      };
      const oldStream = { getVideoTracks: () => [oldTrack] };
      const newStream = { getVideoTracks: () => [newTrack], getTracks: () => [newTrack] };
      const replaceTrack = vi.fn(async () => {
        if (reject) throw new DOMException('renegotiation required', 'InvalidModificationError');
      });
      vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => newStream } });
      vi.stubGlobal('document', { visibilityState: 'visible' });
      const sender = new CameraSender(() => {});
      Object.assign(sender, {
        stream: oldStream,
        pc: {
          getTransceivers: () => [
            { receiver: { track: { kind: 'video' } }, sender: { replaceTrack } },
          ],
        },
      });
      sender.state.capture = 'live';
      await sender.switchCamera('new');
      expect(sender.previewStream).toBe(reject ? oldStream : newStream);
      expect(oldTrack.stop).toHaveBeenCalledTimes(reject ? 0 : 1);
      expect(newTrack.stop).toHaveBeenCalledTimes(reject ? 1 : 0);
      expect(!!sender.state.captureError).toBe(reject);
      expect(sender.state.capture).toBe('live');
    },
  );
});
