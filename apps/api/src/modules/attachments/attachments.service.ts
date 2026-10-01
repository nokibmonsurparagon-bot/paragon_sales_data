import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileTypeFromBuffer } from 'file-type';
import { ALLOWED_ATTACHMENT_EXTENSIONS, ERROR_CODES, type AttachmentDto } from '@paragon/shared';
import { env } from '../../config/env.js';
import { writeAudit } from '../../core/audit.js';
import { roleFor, type AuthenticatedUser } from '../../core/context.js';
import { prisma, withTransaction } from '../../core/db.js';
import { AuthorizationError, BusinessRuleError, NotFoundError, PayloadError, ValidationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { getSetting } from '../../core/settings.js';
import { storage } from '../../core/storage.js';
import { toAttachmentDto } from '../transactions/transaction.mapper.js';
import { transactionRepository as repo } from '../transactions/transaction.repository.js';
import { addHistory } from '../transactions/transactions.service.js';
import { editPolicy, guardActor, guardSubject } from '../transactions/transaction.validation.js';
import { editableFields } from '../workflow/state-machine.js';

const EXT_ALIASES: Record<string, string> = { jpeg: 'jpg' };

export function safeFileName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).normalize('NFC');
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').trim();
  return (cleaned || 'file').slice(0, 255);
}

export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Only the owner (draft/correction) or an editing reviewer may change attachments. */
async function assertCanModify(tx: Parameters<typeof repo.lock>[0], transactionId: string, user: AuthenticatedUser) {
  await repo.lock(tx, transactionId);
  await repo.assertInScope(tx, transactionId, user);
  const t = await tx.salesTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { workflow: true } });
  const saApprover = await repo.salesAdminApprover(tx, transactionId, t.workflow?.cycle ?? 1);
  if (!editableFields(guardSubject(t, saApprover), guardActor(user), await editPolicy()).length) {
    throw new AuthorizationError('You cannot change attachments of this transaction in its current status');
  }
  return t;
}

export const attachmentsService = {
  async list(transactionId: string, user: AuthenticatedUser): Promise<AttachmentDto[]> {
    await repo.assertInScope(prisma, transactionId, user);
    const rows = await prisma.salesTransactionAttachment.findMany({
      where: { transactionId, deletedAt: null },
      orderBy: { uploadedAt: 'asc' },
      include: { uploadedBy: { select: { id: true, fullName: true, email: true } } },
    });
    return rows.map(toAttachmentDto);
  },

  async upload(transactionId: string, file: Express.Multer.File | undefined, user: AuthenticatedUser): Promise<AttachmentDto> {
    if (!file?.buffer?.length) {
      throw new ValidationError('Validation failed', [{ path: 'file', message: 'A non-empty file is required' }]);
    }
    const maxMb = Math.min(await getSetting('upload.maxFileSizeMb'), env.MAX_UPLOAD_MB);
    if (file.size > maxMb * 1024 * 1024) throw new PayloadError(413, ERROR_CODES.FILE_TOO_LARGE, `File exceeds ${maxMb} MB`);

    // Trust the bytes, not the client-supplied name or MIME type.
    const detected = await fileTypeFromBuffer(file.buffer);
    const allowed = ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[];
    if (!detected || !allowed.includes(detected.ext)) {
      throw new PayloadError(415, ERROR_CODES.UNSUPPORTED_FILE_TYPE, `Allowed file types: ${allowed.join(', ').toUpperCase()}`);
    }
    const originalName = safeFileName(file.originalname);
    const nameExt = path.extname(originalName).slice(1).toLowerCase();
    if ((EXT_ALIASES[nameExt] ?? nameExt) !== detected.ext) {
      throw new PayloadError(415, ERROR_CODES.UNSUPPORTED_FILE_TYPE, 'The file extension does not match the file content');
    }
    const maxFiles = await getSetting('upload.maxFilesPerTransaction');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `transactions/${transactionId}/${randomUUID()}.${detected.ext}`;
    const store = storage();
    let stored = false;

    try {
      return await withTransaction(async (tx) => {
        const t = await assertCanModify(tx, transactionId, user);
        if ((await repo.countAttachments(tx, transactionId)) >= maxFiles) {
          throw new BusinessRuleError(`A transaction can have at most ${maxFiles} attachments`);
        }
        await store.put(storageKey, file.buffer, detected.mime);
        stored = true;
        const row = await tx.salesTransactionAttachment.create({
          data: {
            transactionId,
            storageProvider: store.name,
            storageKey,
            originalName,
            mimeType: detected.mime,
            sizeBytes: file.size,
            sha256,
            uploadedById: user.id,
          },
          include: { uploadedBy: { select: { id: true, fullName: true, email: true } } },
        });
        await addHistory(tx, {
          transactionId,
          action: 'ATTACHMENT_ADDED',
          previousStatus: t.status,
          newStatus: t.status,
          actor: user,
          actorRole: roleFor(user),
          comment: originalName,
        });
        await writeAudit(
          { action: 'UPLOAD_ATTACHMENT', entityType: 'SalesTransaction', entityId: transactionId, newData: { attachmentId: row.id, originalName, mimeType: detected.mime, sizeBytes: file.size, sha256 } },
          tx,
        );
        return toAttachmentDto(row);
      });
    } catch (err) {
      if (stored) await store.delete(storageKey).catch((e: unknown) => logger.warn({ e, storageKey }, 'Orphan cleanup failed'));
      throw err;
    }
  },

  async download(attachmentId: string, user: AuthenticatedUser): Promise<{ stream: Readable; name: string; mimeType: string; size: number }> {
    const a = await prisma.salesTransactionAttachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
    if (!a) throw new NotFoundError('Attachment');
    await repo.assertInScope(prisma, a.transactionId, user);
    const stream = await storage().getStream(a.storageKey);
    await writeAudit({ action: 'DOWNLOAD_ATTACHMENT', entityType: 'SalesTransaction', entityId: a.transactionId, newData: { attachmentId } });
    return { stream, name: a.originalName, mimeType: a.mimeType, size: a.sizeBytes };
  },

  async remove(attachmentId: string, user: AuthenticatedUser): Promise<void> {
    const a = await prisma.salesTransactionAttachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
    if (!a) throw new NotFoundError('Attachment');
    await withTransaction(async (tx) => {
      const t = await assertCanModify(tx, a.transactionId, user);
      // Soft delete: the file and metadata are retained for audit purposes.
      await tx.salesTransactionAttachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date(), deletedById: user.id } });
      await addHistory(tx, {
        transactionId: a.transactionId,
        action: 'ATTACHMENT_REMOVED',
        previousStatus: t.status,
        newStatus: t.status,
        actor: user,
        actorRole: roleFor(user),
        comment: a.originalName,
      });
      await writeAudit(
        { action: 'DELETE_ATTACHMENT', entityType: 'SalesTransaction', entityId: a.transactionId, previousData: { attachmentId, originalName: a.originalName } },
        tx,
      );
    });
  },
};
