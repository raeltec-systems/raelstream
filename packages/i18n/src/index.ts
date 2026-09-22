import en from './en.json' with { type: 'json' };

export type MessageKey = keyof typeof en;
export type Params = Record<string, string | number>;

/** Look up a message and interpolate `{name}` placeholders. Unknown params are left as-is. */
export function t(key: MessageKey, params?: Params): string {
  const template: string = en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

export const messages = en;
