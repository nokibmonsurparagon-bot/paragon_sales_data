import { Router } from 'express';
import { z } from 'zod';
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  settingUpdateSchema,
  type ClientConfig,
  type SettingKey,
} from '@paragon/shared';
import { env } from '../../config/env.js';
import { writeAudit } from '../../core/audit.js';
import { prisma, toJson, withTransaction } from '../../core/db.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { authenticate, requirePermission } from '../../core/middleware.js';
import { currentUser, ok, parseBody, parseParams } from '../../core/http.js';
import { getSetting, invalidateSettingsCache, listSettings } from '../../core/settings.js';

export const settingsRouter = Router();
settingsRouter.use(authenticate);

settingsRouter.get('/', requirePermission('SYSTEM_SETTINGS_VIEW'), async (_req, res) => ok(res, await listSettings()));

settingsRouter.patch('/:key', requirePermission('SYSTEM_SETTINGS_UPDATE'), async (req, res) => {
  const { key } = parseParams(z.object({ key: z.string() }), req);
  if (!SETTING_KEYS.includes(key as SettingKey)) throw new NotFoundError('Setting');
  const def = SETTING_DEFINITIONS[key as SettingKey];
  const parsed = def.schema.safeParse(parseBody(settingUpdateSchema, req).value);
  if (!parsed.success) {
    throw new ValidationError('Invalid value', parsed.error.issues.map((i) => ({ path: ['value', ...i.path].join('.'), message: i.message })));
  }
  const user = currentUser(req);
  await withTransaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key } });
    await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: toJson(parsed.data), description: def.description, updatedById: user.id },
      update: { value: toJson(parsed.data), updatedById: user.id },
    });
    await writeAudit(
      { action: 'CHANGE_SYSTEM_SETTING', entityType: 'SystemSetting', entityId: key, previousData: { value: before?.value ?? def.default }, newData: { value: parsed.data } },
      tx,
    );
  });
  invalidateSettingsCache();
  ok(res, (await listSettings(prisma)).find((s) => s.key === key), 'Setting updated');
});

/** Non-sensitive configuration every signed-in user needs (formatting, form limits). */
export const clientConfigRouter = Router();
clientConfigRouter.get('/', authenticate, async (_req, res) => {
  const [currency, timezone, maxMb, maxBackdateDays, allowFutureDate] = await Promise.all([
    getSetting('business.currency'),
    getSetting('business.timezone'),
    getSetting('upload.maxFileSizeMb'),
    getSetting('transaction.maxBackdateDays'),
    getSetting('transaction.allowFutureDate'),
  ]);
  const data: ClientConfig = {
    currency,
    timezone,
    maxUploadMb: Math.min(maxMb, env.MAX_UPLOAD_MB),
    allowedExtensions: [...ALLOWED_ATTACHMENT_EXTENSIONS],
    maxBackdateDays,
    allowFutureDate,
  };
  ok(res, data);
});
