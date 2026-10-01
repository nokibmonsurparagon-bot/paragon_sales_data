import { Router, type Request } from 'express';
import {
  approveSchema,
  bulkApproveSchema,
  bulkRejectSchema,
  claimSchema,
  idParamSchema,
  reassignSchema,
  rejectSchema,
  resolveDuplicateSchema,
  returnSchema,
  simpleActionSchema,
  transactionCreateSchema,
  transactionListQuerySchema,
  transactionUpdateSchema,
  type WorkflowAction,
} from '@paragon/shared';
import { prisma } from '../../core/db.js';
import { authenticate, requirePermission, singleFileUpload } from '../../core/middleware.js';
import { created, currentUser, ok, parseBody, parseParams, parseQuery } from '../../core/http.js';
import { attachmentsService, contentDisposition } from '../attachments/attachments.service.js';
import { duplicatesService } from '../duplicates/duplicates.service.js';
import { workflowService, type ActionInput } from '../workflow/workflow.service.js';
import { transactionsService } from './transactions.service.js';

const VIEW = ['SALES_VIEW_OWN', 'SALES_VIEW_ALL', 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW'] as const;

export const transactionsRouter = Router();
transactionsRouter.use(authenticate);

// ---- Bulk review (single path segment, so it never collides with /:id/...) -------------------
transactionsRouter.post('/bulk-approve', requirePermission('SALES_ADMIN_APPROVE', 'FINANCE_APPROVE'), async (req, res) => {
  const { items, comment } = parseBody(bulkApproveSchema, req);
  const result = await workflowService.bulk('approve', items, { comment }, currentUser(req));
  ok(res, result, `${result.succeeded} approved, ${result.failed} failed`);
});
transactionsRouter.post('/bulk-reject', requirePermission('SALES_ADMIN_REJECT', 'FINANCE_REJECT'), async (req, res) => {
  const { items, reason, correctionCategory } = parseBody(bulkRejectSchema, req);
  const result = await workflowService.bulk('reject', items, { reason, correctionCategory }, currentUser(req));
  ok(res, result, `${result.succeeded} rejected, ${result.failed} failed`);
});

// ---- CRUD ------------------------------------------------------------------------------------
transactionsRouter.get('/', requirePermission(...VIEW), async (req, res) =>
  ok(res, await transactionsService.list(parseQuery(transactionListQuerySchema, req), currentUser(req))),
);

transactionsRouter.post('/', requirePermission('SALES_CREATE'), async (req, res) =>
  created(res, await transactionsService.create(parseBody(transactionCreateSchema, req), currentUser(req)), 'Draft saved'),
);

transactionsRouter.get('/:id', requirePermission(...VIEW), async (req, res) =>
  ok(res, await transactionsService.get(parseParams(idParamSchema, req).id, currentUser(req))),
);

transactionsRouter.patch('/:id', requirePermission('SALES_EDIT', 'SALES_ADMIN_EDIT', 'FINANCE_EDIT'), async (req, res) =>
  ok(
    res,
    await transactionsService.update(parseParams(idParamSchema, req).id, parseBody(transactionUpdateSchema, req), currentUser(req)),
    'Transaction saved',
  ),
);

transactionsRouter.get('/:id/history', requirePermission(...VIEW), async (req, res) =>
  ok(res, await transactionsService.history(parseParams(idParamSchema, req).id, currentUser(req))),
);

// ---- Workflow --------------------------------------------------------------------------------
async function run(req: Request, action: WorkflowAction, input: ActionInput) {
  return workflowService.execute(parseParams(idParamSchema, req).id, action, input, currentUser(req));
}

transactionsRouter.post('/:id/submit', requirePermission('SALES_SUBMIT'), async (req, res) =>
  ok(res, await run(req, 'SUBMIT', parseBody(simpleActionSchema, req)), 'Transaction submitted for review'),
);
transactionsRouter.post('/:id/resubmit', requirePermission('SALES_SUBMIT'), async (req, res) =>
  ok(res, await run(req, 'RESUBMIT', parseBody(simpleActionSchema, req)), 'Transaction resubmitted for review'),
);
transactionsRouter.post('/:id/cancel', requirePermission('SALES_EDIT', 'TRANSACTION_CANCEL_ANY'), async (req, res) =>
  ok(res, await run(req, 'CANCEL', parseBody(simpleActionSchema, req)), 'Transaction cancelled'),
);

/** approve / reject / return are stage-agnostic; the current status decides SA vs finance. */
function review(req: Request, verb: 'approve' | 'reject' | 'return', input: ActionInput) {
  return workflowService.review(parseParams(idParamSchema, req).id, verb, input, currentUser(req));
}

transactionsRouter.post('/:id/approve', requirePermission('SALES_ADMIN_APPROVE', 'FINANCE_APPROVE'), async (req, res) =>
  ok(res, await review(req, 'approve', parseBody(approveSchema, req)), 'Transaction approved successfully'),
);
transactionsRouter.post('/:id/reject', requirePermission('SALES_ADMIN_REJECT', 'FINANCE_REJECT'), async (req, res) =>
  ok(res, await review(req, 'reject', parseBody(rejectSchema, req)), 'Transaction rejected'),
);
transactionsRouter.post('/:id/return', requirePermission('SALES_ADMIN_REJECT', 'FINANCE_REJECT'), async (req, res) =>
  ok(res, await review(req, 'return', parseBody(returnSchema, req)), 'Transaction returned for correction'),
);

transactionsRouter.post('/:id/claim', requirePermission('SALES_ADMIN_REVIEW', 'FINANCE_REVIEW'), async (req, res) =>
  ok(res, await workflowService.claim(parseParams(idParamSchema, req).id, parseBody(claimSchema, req).version, currentUser(req)), 'Claimed'),
);
transactionsRouter.post('/:id/release', requirePermission('SALES_ADMIN_REVIEW', 'FINANCE_REVIEW', 'TRANSACTION_ASSIGN'), async (req, res) =>
  ok(res, await workflowService.release(parseParams(idParamSchema, req).id, parseBody(claimSchema, req).version, currentUser(req)), 'Released'),
);
transactionsRouter.post('/:id/reassign', requirePermission('TRANSACTION_ASSIGN'), async (req, res) => {
  const body = parseBody(reassignSchema, req);
  ok(res, await workflowService.reassign(parseParams(idParamSchema, req).id, body.version, body.userId, currentUser(req)), 'Reassigned');
});

// ---- Duplicates ------------------------------------------------------------------------------
transactionsRouter.get('/:id/duplicates', requirePermission(...VIEW, 'EXCEPTION_VIEW'), async (req, res) =>
  ok(res, await duplicatesService.candidates(parseParams(idParamSchema, req).id, currentUser(req))),
);
transactionsRouter.post('/:id/duplicates/resolve', requirePermission('EXCEPTION_RESOLVE'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req);
  const user = currentUser(req);
  await duplicatesService.resolve(id, parseBody(resolveDuplicateSchema, req), user);
  ok(res, await transactionsService.detail(prisma, id, user), 'Duplicate warning resolved');
});

// ---- Attachments -----------------------------------------------------------------------------
transactionsRouter.get('/:id/attachments', requirePermission(...VIEW), async (req, res) =>
  ok(res, await attachmentsService.list(parseParams(idParamSchema, req).id, currentUser(req))),
);
transactionsRouter.post(
  '/:id/attachments',
  requirePermission('SALES_EDIT', 'SALES_ADMIN_EDIT', 'FINANCE_EDIT'),
  singleFileUpload,
  async (req, res) =>
    created(res, await attachmentsService.upload(parseParams(idParamSchema, req).id, req.file, currentUser(req)), 'File uploaded'),
);

export const attachmentsRouter = Router();
attachmentsRouter.use(authenticate);

attachmentsRouter.get('/:id/download', requirePermission(...VIEW), async (req, res) => {
  const file = await attachmentsService.download(parseParams(idParamSchema, req).id, currentUser(req));
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', contentDisposition(file.name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  file.stream.pipe(res);
});

attachmentsRouter.delete('/:id', requirePermission('SALES_EDIT', 'SALES_ADMIN_EDIT', 'FINANCE_EDIT'), async (req, res) => {
  await attachmentsService.remove(parseParams(idParamSchema, req).id, currentUser(req));
  ok(res, null, 'Attachment removed');
});
