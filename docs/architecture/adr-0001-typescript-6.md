# ADR-0001: TypeScript 6.0 instead of 7.x

- **Status:** Accepted (22 Sep 2026)
- **Context:** SPEC §4.3.1 says to use the newest stable release. TypeScript 7.x is current, but
  typescript-eslint 8.70 (the newest release) declares support only for `typescript >=4.8.4 <6.1.0`.
- **Decision:** Pin TypeScript 6.0.3, using the fallback the spec allows.
- **Revisit when:** typescript-eslint supports TS 7. The upgrade must then pass the full `pnpm ci:local`.
