import { useState } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, IconButton, Collapse, Box, Typography, Chip,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import ScoreBadge from '../common/ScoreBadge';
import MatchTypeBadge from '../common/MatchTypeBadge';
import FieldScoreBreakdown from './FieldScoreBreakdown';

function ResultRow({ result, profileFields, onRowClick }) {
  const [open, setOpen] = useState(false);
  const hasBreakdown = result.field_scores && Object.keys(result.field_scores).filter(k => k !== '_fastpath').length > 0;

  return (
    <>
      <TableRow 
        hover 
        onClick={() => onRowClick(result)}
        sx={{ cursor: 'pointer' }}
      >
        <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
          {hasBreakdown && (
            <IconButton size="small" onClick={() => setOpen(!open)}>
              {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>
          )}
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={600}>{result.display_name || '-'}</Typography>
          <Typography variant="caption" color="text.secondary">{result.entity_id?.slice(0, 8)}...</Typography>
        </TableCell>
        <TableCell align="center"><ScoreBadge score={result.match_score} /></TableCell>
        <TableCell align="center"><MatchTypeBadge type={result.match_type} /></TableCell>
        <TableCell align="center">
          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
            {result.was_cached && <Chip label="CACHED" size="small" variant="outlined" color="info" />}
            {result.is_new_entity && <Chip label="NEW" size="small" variant="outlined" color="success" />}
          </Box>
        </TableCell>
        <TableCell align="right">
          <Typography variant="caption">{result.execution_ms}ms</Typography>
        </TableCell>
      </TableRow>
      {hasBreakdown && (
        <TableRow>
          <TableCell colSpan={6} sx={{ py: 0, bgcolor: 'grey.50' }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ py: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, pl: 2 }}>Field Score Breakdown</Typography>
                <FieldScoreBreakdown fieldScores={result.field_scores} profileFields={profileFields} />
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function ResultsTable({ results, profileFields, onRowClick }) {
  if (!results || results.length === 0) return null;

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            <TableCell>Entity</TableCell>
            <TableCell align="center">Score</TableCell>
            <TableCell align="center">Match Type</TableCell>
            <TableCell align="center">Flags</TableCell>
            <TableCell align="right">Latency</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {results.map((r, i) => (
            <ResultRow key={r.entity_id || i} result={r} profileFields={profileFields} onRowClick={onRowClick} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
