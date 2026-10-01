import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TRANSACTION_STATUSES, TRANSACTION_STATUS_LABELS } from '@paragon/shared';
import { checkFile } from '../features/transactions/AttachmentsPanel';
import { ApiError } from '../api/client';
import { ConfirmDialog } from './ConfirmDialog';
import { errorText } from './Notifier';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it.each(TRANSACTION_STATUSES)('always shows a text label for %s (not colour only)', (status) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(TRANSACTION_STATUS_LABELS[status])).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('requires a reason and a category before confirming a return', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Return" input="reason" category="required" confirmLabel="Return" onClose={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 5 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/select a correction category/i)).toBeInTheDocument();
  });

  it('confirms with an optional comment', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Approve" input="comment" confirmLabel="Approve" onClose={() => {}} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  looks fine ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onConfirm).toHaveBeenCalledWith({ text: 'looks fine', category: undefined });
  });
});

describe('client-side file checks', () => {
  const file = (name: string, size: number) => new File([new Uint8Array(size)], name);
  it('accepts allowed types within size', () => {
    expect(checkFile(file('receipt.PDF', 10), 1, ['pdf'])).toBeNull();
    expect(checkFile(file('photo.jpeg', 10), 1, ['jpg'])).toBeNull();
  });
  it('rejects other types, empty and oversized files', () => {
    expect(checkFile(file('virus.exe', 10), 1, ['pdf'])).toMatch(/only/);
    expect(checkFile(file('a.pdf', 0), 1, ['pdf'])).toMatch(/empty/);
    expect(checkFile(file('a.pdf', 2 * 1024 * 1024), 1, ['pdf'])).toMatch(/larger/);
  });
});

describe('error messages', () => {
  it('includes validation details and a reference id for server errors', () => {
    expect(errorText(new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', [{ path: 'amount', message: 'Too big' }]))).toBe(
      'Validation failed – amount: Too big',
    );
    expect(errorText(new ApiError(500, 'INTERNAL_ERROR', 'Oops', [], 'req-1'))).toBe('Oops (ref req-1)');
  });
});
