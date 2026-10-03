import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { MASTER_IMPORT_COLUMNS, MASTER_IMPORT_MAX_MB, MASTER_IMPORT_MAX_ROWS, type MasterDataEntity, type MasterImportResult } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { errorText, useNotifier } from '../../components/Notifier';

const SHOWN = 100;

/**
 * Excel / CSV import in two steps: "Check file" (nothing is written) shows what would be added / updated and every
 * error; "Import" then applies the same file in one go (all or nothing).
 */
export function ImportDialog({ entity, label, open, onClose }: { entity: MasterDataEntity; label: string; open: boolean; onClose(): void }) {
  const qc = useQueryClient();
  const { notify, notifyError } = useNotifier();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<MasterImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
      setError(null);
    }
  }, [open]);

  const run = useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) => api.master.importFile(entity, file!, dryRun),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      if (r.applied) {
        notify(`${label}: ${r.created} added, ${r.updated} updated`);
        void qc.invalidateQueries({ queryKey: ['master'] });
        void qc.invalidateQueries({ queryKey: ['master-options'] });
        void qc.invalidateQueries({ queryKey: ['master-search'] });
      }
    },
    onError: (e) => {
      setResult(null);
      setError(errorText(e));
    },
  });

  const columns = MASTER_IMPORT_COLUMNS[entity];
  const changes = result ? result.created + result.updated : 0;
  const canImport = !!result && !result.applied && result.errors.length === 0 && changes > 0;

  return (
    <Dialog open={open} onClose={run.isPending ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Import {label} from Excel</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            Columns: {columns.map((c) => `${c.header}${c.required ? ' *' : ''}`).join(' · ')}. Rows are matched on the code – new codes are added,
            existing ones updated; nothing is deleted. Up to {MASTER_IMPORT_MAX_ROWS.toLocaleString()} rows, {MASTER_IMPORT_MAX_MB} MB, .xlsx or .csv.
          </Typography>
          <Stack direction="row" spacing={2}>
            <Link component="button" type="button" onClick={() => void api.master.template(entity, false).catch(notifyError)}>
              Download empty template
            </Link>
            <Link component="button" type="button" onClick={() => void api.master.template(entity, true).catch(notifyError)}>
              Download current list (edit and import back)
            </Link>
          </Stack>

          <Box>
            <input
              ref={input}
              type="file"
              hidden
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
                setError(null);
                e.target.value = '';
              }}
            />
            <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => input.current?.click()} disabled={run.isPending}>
              {file ? 'Choose another file' : 'Choose file'}
            </Button>
            {file && (
              <Typography component="span" sx={{ ml: 2 }}>
                {file.name}
              </Typography>
            )}
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          {result && (
            <>
              {result.applied ? (
                <Alert severity="success">
                  Imported {result.fileName}: {result.created} added, {result.updated} updated, {result.unchanged} unchanged.
                </Alert>
              ) : result.errors.length ? (
                <Alert severity="error">
                  {result.errors.length} problem(s) found – nothing was imported. Correct the file and check it again.
                </Alert>
              ) : changes ? (
                <Alert severity="info">File is OK. Nothing has been saved yet – press Import to apply the changes below.</Alert>
              ) : (
                <Alert severity="info">Nothing to change – every row already matches the current list.</Alert>
              )}
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                <Chip label={`${result.totalRows} rows`} />
                <Chip color="success" variant="outlined" label={`${result.created} new`} />
                <Chip color="primary" variant="outlined" label={`${result.updated} to update`} />
                <Chip variant="outlined" label={`${result.unchanged} unchanged`} />
                {result.errors.length > 0 && <Chip color="error" label={`${result.errors.length} errors`} />}
              </Stack>

              {result.errors.length > 0 && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Row</TableCell>
                      <TableCell>Column</TableCell>
                      <TableCell>Problem</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.errors.slice(0, SHOWN).map((e, i) => (
                      <TableRow key={i}>
                        <TableCell>{e.row}</TableCell>
                        <TableCell>{e.column ?? '—'}</TableCell>
                        <TableCell>{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {result.errors.length === 0 && result.preview.length > 0 && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Row</TableCell>
                      <TableCell>Code</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Change</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.preview.slice(0, SHOWN).map((p) => (
                      <TableRow key={p.row}>
                        <TableCell>{p.row}</TableCell>
                        <TableCell>{p.code}</TableCell>
                        <TableCell>{p.name}</TableCell>
                        <TableCell>{p.action === 'create' ? <Chip size="small" color="success" variant="outlined" label="New" /> : p.changes.join('; ')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {(result.errors.length > SHOWN || (result.errors.length === 0 && changes > SHOWN)) && (
                <Typography variant="caption" color="text.secondary">
                  Showing the first {SHOWN} rows.
                </Typography>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={run.isPending}>
          {result?.applied ? 'Close' : 'Cancel'}
        </Button>
        {!result?.applied && (
          <Button variant="outlined" onClick={() => run.mutate({ dryRun: true })} disabled={!file || run.isPending}>
            {run.isPending && run.variables?.dryRun ? 'Checking…' : 'Check file'}
          </Button>
        )}
        {!result?.applied && (
          <Button variant="contained" onClick={() => run.mutate({ dryRun: false })} disabled={!canImport || run.isPending}>
            {run.isPending && !run.variables?.dryRun ? 'Importing…' : `Import ${changes || ''}`.trim()}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
