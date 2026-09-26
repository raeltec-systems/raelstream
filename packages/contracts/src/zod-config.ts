import { z } from 'zod';

// The studio runs under script-src 'self' (no eval). Zod otherwise probes new Function() to compile
// parsers, which the CSP reports as a violation; the interpreted path is plenty fast here.
z.config({ jitless: true });
