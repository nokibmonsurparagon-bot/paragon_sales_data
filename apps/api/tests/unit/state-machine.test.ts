import { describe, expect, it } from 'vitest';
import type { Permission, TransactionStatus, WorkflowAction } from '@paragon/shared';
import { TRANSACTION_STATUSES, WORKFLOW_ACTIONS } from '@paragon/shared';
import {
  TRANSITIONS,
  allowedActions,
  checkTransition,
  editableFields,
  resolveReviewAction,
  type GuardActor,
  type GuardSubject,
} from '../../src/modules/workflow/state-machine.js';

const OWNER = 'owner-id';
const SA = 'sa-id';
const FIN = 'fin-id';
const ACCOUNTANT_ROLE = 'role-accountant';
const TREASURY_ROLE = 'role-treasury';
const DOC = 'wing-doc';
const FEED = 'wing-feed';

const subject = (over: Partial<GuardSubject> = {}): GuardSubject => ({
  status: 'DRAFT',
  wingId: DOC,
  createdById: OWNER,
  fieldForceUserId: OWNER,
  assignedRoleId: null,
  assignedUserId: null,
  duplicateStatus: 'NO_DUPLICATE',
  duplicateResolution: null,
  salesAdminApproverId: null,
  ...over,
});

const actor = (id: string, perms: Permission[], roleIds: string[] = [], wingIds: string[] = [DOC], allWings = false): GuardActor => ({
  id,
  permissions: new Set(perms),
  roleIds,
  wingIds,
  allWings,
});

const ff = actor(OWNER, ['SALES_CREATE', 'SALES_EDIT', 'SALES_SUBMIT', 'SALES_VIEW_OWN']);
const sa = actor(SA, ['SALES_ADMIN_REVIEW', 'SALES_ADMIN_EDIT', 'SALES_ADMIN_APPROVE', 'SALES_ADMIN_REJECT', 'EXCEPTION_RESOLVE']);
const accountant = actor(FIN, ['FINANCE_REVIEW', 'FINANCE_EDIT', 'FINANCE_APPROVE', 'FINANCE_REJECT'], [ACCOUNTANT_ROLE]);
const policy = { salesAdminEditableFields: ['remarks', 'bankId'] as const, financeEditableFields: ['remarks'] as const };

describe('transition table', () => {
  it('defines every workflow action', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...WORKFLOW_ACTIONS].sort());
  });

  it('only allows the documented transitions from each status', () => {
    const allowed: Record<string, WorkflowAction[]> = {};
    for (const s of TRANSACTION_STATUSES) {
      allowed[s] = WORKFLOW_ACTIONS.filter((a) => TRANSITIONS[a].from.includes(s));
    }
    expect(allowed).toEqual({
      DRAFT: ['SUBMIT', 'CANCEL'],
      SALES_ADMIN_REVIEW: ['CANCEL', 'SA_APPROVE', 'SA_RETURN', 'SA_REJECT'],
      FINANCE_REVIEW: ['CANCEL', 'FIN_APPROVE', 'FIN_RETURN', 'FIN_REJECT'],
      CORRECTION_REQUIRED: ['RESUBMIT', 'CANCEL'],
      REJECTED: [],
      READY_FOR_PROCESSING: [],
      CANCELLED: [],
    });
  });

  it('terminal statuses allow nothing', () => {
    for (const status of ['REJECTED', 'READY_FOR_PROCESSING', 'CANCELLED'] as TransactionStatus[]) {
      for (const a of WORKFLOW_ACTIONS) {
        expect(checkTransition(a, subject({ status }), actor('x', ['TRANSACTION_CANCEL_ANY', 'SALES_ADMIN_APPROVE'])).ok).toBe(false);
      }
    }
  });

  it('maps REST verbs to stage actions', () => {
    expect(resolveReviewAction('approve', 'SALES_ADMIN_REVIEW')).toBe('SA_APPROVE');
    expect(resolveReviewAction('return', 'FINANCE_REVIEW')).toBe('FIN_RETURN');
    expect(resolveReviewAction('approve', 'DRAFT')).toBeNull();
  });
});

describe('owner actions', () => {
  it('owner can submit a draft', () => {
    expect(checkTransition('SUBMIT', subject(), ff).ok).toBe(true);
  });
  it('another user with SALES_SUBMIT cannot submit it', () => {
    const r = checkTransition('SUBMIT', subject(), actor('other', ['SALES_SUBMIT']));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it('owner cannot cancel once submitted, admin can', () => {
    expect(checkTransition('CANCEL', subject({ status: 'SALES_ADMIN_REVIEW' }), ff).ok).toBe(false);
    expect(checkTransition('CANCEL', subject({ status: 'SALES_ADMIN_REVIEW' }), actor('adm', ['TRANSACTION_CANCEL_ANY'])).ok).toBe(true);
  });
  it('rejects invalid transitions with 422', () => {
    expect(checkTransition('RESUBMIT', subject(), ff)).toMatchObject({ ok: false, status: 422, code: 'INVALID_TRANSITION' });
  });
});

describe('reviewer guards', () => {
  const inSa = subject({ status: 'SALES_ADMIN_REVIEW' });
  const inFin = subject({ status: 'FINANCE_REVIEW', assignedRoleId: ACCOUNTANT_ROLE, salesAdminApproverId: SA });

  it('Sales Admin can approve', () => expect(checkTransition('SA_APPROVE', inSa, sa).ok).toBe(true));

  it('prevents self-approval even with the permission', () => {
    const selfApprover = actor(OWNER, ['SALES_ADMIN_APPROVE', 'SALES_ADMIN_REVIEW']);
    expect(checkTransition('SA_APPROVE', inSa, selfApprover)).toMatchObject({ ok: false, code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('requires the permission', () => {
    expect(checkTransition('SA_APPROVE', inSa, ff)).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' });
    expect(checkTransition('FIN_APPROVE', inFin, sa)).toMatchObject({ ok: false, status: 403 });
  });

  it('requires the assigned finance role', () => {
    const treasury = actor('t', ['FINANCE_APPROVE', 'FINANCE_REVIEW'], [TREASURY_ROLE]);
    expect(checkTransition('FIN_APPROVE', inFin, treasury)).toMatchObject({ ok: false, code: 'NOT_ASSIGNED_ROLE' });
    expect(checkTransition('FIN_APPROVE', inFin, accountant).ok).toBe(true);
  });

  it('enforces segregation of duties at final approval', () => {
    const both = actor(SA, ['FINANCE_APPROVE', 'FINANCE_REVIEW'], [ACCOUNTANT_ROLE]);
    expect(checkTransition('FIN_APPROVE', inFin, both)).toMatchObject({ ok: false, code: 'SEGREGATION_OF_DUTIES' });
    // …but may still return it
    expect(checkTransition('FIN_RETURN', inFin, actor(SA, ['FINANCE_REJECT'], [ACCOUNTANT_ROLE])).ok).toBe(true);
  });

  it('respects claims by other reviewers', () => {
    expect(checkTransition('SA_APPROVE', { ...inSa, assignedUserId: 'someone-else' }, sa)).toMatchObject({ code: 'CLAIMED_BY_OTHER' });
    expect(checkTransition('SA_APPROVE', { ...inSa, assignedUserId: SA }, sa).ok).toBe(true);
  });

  it('blocks approval of unresolved exact duplicates but allows return/reject', () => {
    const dup = { ...inSa, duplicateStatus: 'EXACT_DUPLICATE' as const, duplicateResolution: 'PENDING' as const };
    expect(checkTransition('SA_APPROVE', dup, sa)).toMatchObject({ ok: false, status: 422, code: 'DUPLICATE_UNRESOLVED' });
    expect(checkTransition('SA_REJECT', dup, sa).ok).toBe(true);
    expect(checkTransition('SA_APPROVE', { ...dup, duplicateResolution: 'NOT_DUPLICATE' }, sa).ok).toBe(true);
    expect(checkTransition('SA_APPROVE', { ...dup, duplicateResolution: 'CONFIRMED_DUPLICATE' }, sa)).toMatchObject({ code: 'DUPLICATE_CONFIRMED' });
  });

  it('possible duplicates only warn', () => {
    const dup = { ...inSa, duplicateStatus: 'POSSIBLE_DUPLICATE' as const, duplicateResolution: 'PENDING' as const };
    expect(checkTransition('SA_APPROVE', dup, sa).ok).toBe(true);
  });
});

describe('wings', () => {
  const feedSa = actor(SA, [...sa.permissions], [], [FEED]);
  const inSaFeed = subject({ status: 'SALES_ADMIN_REVIEW', wingId: FEED });
  const inSaDoc = subject({ status: 'SALES_ADMIN_REVIEW', duplicateStatus: 'EXACT_DUPLICATE', duplicateResolution: 'PENDING' });

  it('reviewers act only on their own wings', () => {
    expect(checkTransition('SA_APPROVE', inSaFeed, feedSa).ok).toBe(true);
    expect(checkTransition('SA_APPROVE', inSaDoc, feedSa)).toMatchObject({ ok: false, status: 403, code: 'WING_NOT_ASSIGNED' });
    expect(checkTransition('SA_RETURN', inSaDoc, feedSa)).toMatchObject({ code: 'WING_NOT_ASSIGNED' });
    expect(allowedActions(inSaDoc, feedSa, policy)).toEqual([]);
    expect(editableFields(inSaDoc, feedSa, policy)).toEqual([]);
  });

  it('finance needs both the routed role and the wing', () => {
    const inFin = subject({ status: 'FINANCE_REVIEW', assignedRoleId: ACCOUNTANT_ROLE, wingId: FEED });
    expect(checkTransition('FIN_APPROVE', inFin, accountant)).toMatchObject({ code: 'WING_NOT_ASSIGNED' });
    const central = actor(FIN, [...accountant.permissions], [ACCOUNTANT_ROLE], [], true);
    expect(checkTransition('FIN_APPROVE', inFin, central).ok).toBe(true);
  });

  it('owners may move their own draft to another wing', () => {
    expect(editableFields(subject(), ff, policy)).toContain('wingId');
  });
});

describe('editable fields and offered actions', () => {
  it('owner edits all fields (except field force) in draft', () => {
    expect(editableFields(subject(), ff, policy)).not.toContain('fieldForceUserId');
    expect(editableFields(subject(), ff, policy)).toContain('amount');
  });
  it('owner cannot edit while under review', () => {
    expect(editableFields(subject({ status: 'SALES_ADMIN_REVIEW' }), ff, policy)).toEqual([]);
  });
  it('Sales Admin edits only configured fields', () => {
    expect(editableFields(subject({ status: 'SALES_ADMIN_REVIEW' }), sa, policy)).toEqual(['remarks', 'bankId']);
  });
  it('offers the right buttons', () => {
    expect(allowedActions(subject(), ff, policy)).toEqual(expect.arrayContaining(['SUBMIT', 'CANCEL', 'EDIT']));
    const saActions = allowedActions(subject({ status: 'SALES_ADMIN_REVIEW' }), sa, policy);
    expect(saActions).toEqual(expect.arrayContaining(['SA_APPROVE', 'SA_RETURN', 'SA_REJECT', 'CLAIM', 'EDIT']));
    expect(saActions).not.toContain('FIN_APPROVE');
    expect(allowedActions(subject({ status: 'SALES_ADMIN_REVIEW' }), ff, policy)).toEqual([]);
  });
});
