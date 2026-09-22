/** Public output profiles (SPEC §11.2, §12.3). Fixed per session; never changed midstream (B§14.3). */
export type ProfileId = 'full_hd' | 'reliable_hd';

export interface OutputProfile {
  id: ProfileId;
  width: number;
  height: number;
  fps: 30;
  videoBitrate: number;
  keyframeSeconds: 2;
  audioBitrate: 128_000;
  audioRate: 44_100;
}

export const PROFILES: Record<ProfileId, OutputProfile> = {
  full_hd: {
    id: 'full_hd',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 6_000_000,
    keyframeSeconds: 2,
    audioBitrate: 128_000,
    audioRate: 44_100,
  },
  reliable_hd: {
    id: 'reliable_hd',
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: 3_800_000,
    keyframeSeconds: 2,
    audioBitrate: 128_000,
    audioRate: 44_100,
  },
};
