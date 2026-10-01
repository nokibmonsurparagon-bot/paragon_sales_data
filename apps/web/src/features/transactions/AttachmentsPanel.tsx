import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionIcon from '@mui/icons-material/Description';
import DownloadIcon from '@mui/icons-material/Download';
import type { AttachmentDto } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useNotifier } from '../../components/Notifier';
import { useClientConfig } from '../../hooks';
import { formatBytes, formatDateTime } from '../../utils/format';

export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.xlsx';

/** Client-side pre-check (the server re-validates by content). */
export function checkFile(file: File, maxMb: number, allowed: string[]): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const normalized = ext === 'jpeg' ? 'jpg' : ext;
  if (!allowed.includes(normalized)) return `${file.name}: only ${allowed.join(', ').toUpperCase()} files are allowed`;
  if (file.size > maxMb * 1024 * 1024) return `${file.name}: larger than ${maxMb} MB`;
  if (file.size === 0) return `${file.name}: file is empty`;
  return null;
}

export function FilePickerButton({ onFiles, disabled, label = 'Add document' }: { onFiles(files: File[]): void; disabled?: boolean; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button startIcon={<AttachFileIcon />} onClick={() => input.current?.click()} disabled={disabled} variant="outlined">
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={ACCEPT}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </>
  );
}

export function AttachmentsPanel({ transactionId, attachments, canEdit }: { transactionId: string; attachments: AttachmentDto[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const { notify, notifyError } = useNotifier();
  const cfg = useClientConfig().data;
  const [progress, setProgress] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<AttachmentDto | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['transaction', transactionId] });
    void qc.invalidateQueries({ queryKey: ['history', transactionId] });
  };

  const upload = async (files: File[]) => {
    for (const f of files) {
      const problem = checkFile(f, cfg?.maxUploadMb ?? 10, cfg?.allowedExtensions ?? ['pdf', 'jpg', 'png', 'xlsx']);
      if (problem) {
        notify(problem, 'error');
        continue;
      }
      try {
        setProgress(0);
        await api.transactions.upload(transactionId, f, setProgress);
        notify(`${f.name} uploaded`);
      } catch (e) {
        notifyError(e);
      } finally {
        setProgress(null);
      }
    }
    refresh();
  };

  const remove = useMutation({
    mutationFn: (a: AttachmentDto) => api.transactions.removeAttachment(a.id),
    onSuccess: () => {
      notify('Attachment removed');
      setToDelete(null);
      refresh();
    },
    onError: notifyError,
  });

  return (
    <Box>
      {attachments.length === 0 && (
        <Typography color="text.secondary" variant="body2" sx={{ mb: 1 }}>
          No supporting documents yet.
        </Typography>
      )}
      <List dense disablePadding>
        {attachments.map((a) => (
          <ListItem
            key={a.id}
            disableGutters
            secondaryAction={
              <>
                <Tooltip title="Download">
                  <IconButton aria-label={`Download ${a.originalName}`} onClick={() => void api.transactions.downloadAttachment(a.id, a.originalName).catch(notifyError)}>
                    <DownloadIcon />
                  </IconButton>
                </Tooltip>
                {canEdit && (
                  <Tooltip title="Remove">
                    <IconButton aria-label={`Remove ${a.originalName}`} onClick={() => setToDelete(a)}>
                      <DeleteOutlineIcon />
                    </IconButton>
                  </Tooltip>
                )}
              </>
            }
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              <DescriptionIcon color="action" />
            </ListItemIcon>
            <ListItemText
              primary={a.originalName}
              secondary={`${formatBytes(a.sizeBytes)} · ${a.uploadedBy.fullName} · ${formatDateTime(a.uploadedAt)}`}
              slotProps={{ primary: { sx: { overflowWrap: 'anywhere', pr: 10 } } }}
            />
          </ListItem>
        ))}
      </List>
      {progress !== null && <LinearProgress variant="determinate" value={progress} sx={{ my: 1 }} />}
      {canEdit && (
        <Box sx={{ mt: 1 }}>
          <FilePickerButton onFiles={(f) => void upload(f)} disabled={progress !== null} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            PDF, JPG, PNG or XLSX · max {cfg?.maxUploadMb ?? 10} MB each
          </Typography>
        </Box>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Remove attachment?"
        message={`"${toDelete?.originalName}" will be removed from this transaction. The upload remains in the audit history.`}
        confirmLabel="Remove"
        confirmColor="error"
        busy={remove.isPending}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </Box>
  );
}
