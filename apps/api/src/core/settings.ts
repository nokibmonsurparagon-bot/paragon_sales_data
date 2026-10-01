import { SETTING_DEFINITIONS, type SettingKey, type SettingValue } from '@paragon/shared';
import { prisma, type Db } from './db.js';
import { logger } from './logger.js';

const TTL_MS = 30_000;
let cache: { at: number; values: Map<string, unknown> } | null = null;

async function load(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const rows = await prisma.systemSetting.findMany();
  cache = { at: Date.now(), values: new Map(rows.map((r) => [r.key, r.value])) };
  return cache.values;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/** Typed setting accessor. Invalid or missing stored values fall back to the documented default. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const def = SETTING_DEFINITIONS[key];
  const stored = (await load()).get(key);
  if (stored !== undefined) {
    const parsed = def.schema.safeParse(stored);
    if (parsed.success) return parsed.data as SettingValue<K>;
    logger.warn({ key }, 'Stored setting is invalid, using default');
  }
  return def.default as SettingValue<K>;
}

export async function listSettings(db: Db = prisma) {
  const rows = await db.systemSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => {
    const row = byKey.get(key);
    return {
      key,
      value: row?.value ?? SETTING_DEFINITIONS[key].default,
      description: row?.description ?? SETTING_DEFINITIONS[key].description,
      updatedAt: (row?.updatedAt ?? new Date(0)).toISOString(),
    };
  });
}

/** Calendar date (YYYY-MM-DD) "today" in the business time zone. */
export async function businessToday(): Promise<string> {
  const tz = await getSetting('business.timezone');
  return dateInZone(new Date(), tz);
}

export function dateInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** UTC instant at which the given business-zone calendar day starts. */
export function startOfDayInZone(day: string, timeZone: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(utcMidnight);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asZone = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    const offset = asZone - utcMidnight.getTime();
    return new Date(utcMidnight.getTime() - offset);
  } catch {
    return utcMidnight;
  }
}
