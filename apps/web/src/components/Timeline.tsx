import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { HISTORY_ACTION_LABELS, TRANSACTION_FIELD_LABELS, type HistoryEntry } from '@paragon/shared';
import { formatDateTime, humanize } from '../utils/format';
import { StatusBadge } from './StatusBadge';

const DOT: Record<string, string> = {
  APPROVED: 'success.main',
  READY: 'success.main',
  REJECTED: 'error.main',
  RETURNED: 'warning.main',
  DUPLICATE: 'warning.main',
  CANCELLED: 'text.disabled',
};

function dotColor(action: string): string {
  const key = Object.keys(DOT).find((k) => action.includes(k));
  return key ? DOT[key]! : 'primary.main';
}

/** Vertical timeline of transaction history (spec §17). */
export function Timeline({ entries }: { entries: HistoryEntry[] }) {
  return (
    <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Transaction history">
      {entries.map((e, i) => (
        <Box component="li" key={e.id} sx={{ display: 'flex', gap: 1.5 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.6 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: dotColor(e.action), flexShrink: 0 }} />
            {i < entries.length - 1 && <Box sx={{ width: 2, flex: 1, bgcolor: 'divider', my: 0.5 }} />}
          </Box>
          <Box sx={{ pb: 2.5, minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography fontWeight={600} fontSize={14}>
                {HISTORY_ACTION_LABELS[e.action] ?? humanize(e.action)}
              </Typography>
              {e.newStatus && e.newStatus !== e.previousStatus && <StatusBadge status={e.newStatus} />}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {formatDateTime(e.createdAt)} · {e.actor.fullName}
              {e.actorRole ? ` (${humanize(e.actorRole)})` : ''}
            </Typography>
            {e.comment && (
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {e.comment}
              </Typography>
            )}
            {e.changes && (
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: 13, color: 'text.secondary' }}>
                {Object.entries(e.changes).map(([field, c]) => (
                  <li key={field}>
                    {TRANSACTION_FIELD_LABELS[field as keyof typeof TRANSACTION_FIELD_LABELS] ?? field}:{' '}
                    <s>{String(c.from ?? '—')}</s> → <b>{String(c.to ?? '—')}</b>
                  </li>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
