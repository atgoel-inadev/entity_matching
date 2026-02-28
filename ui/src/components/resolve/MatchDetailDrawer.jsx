import { useState, useEffect } from 'react';
import {
  Drawer, Box, Typography, IconButton, Stack, Divider, Chip, Table, TableBody,
  TableRow, TableCell, Paper, Alert, CircularProgress, TableContainer,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useSnackbar } from 'notistack';
import { getEntity } from '../../api/entities';
import ScoreBadge from '../common/ScoreBadge';
import MatchTypeBadge from '../common/MatchTypeBadge';

export default function MatchDetailDrawer({ matchResult, profileSlug, open, onClose, profileFields }) {
  const { enqueueSnackbar } = useSnackbar();
  const [entity, setEntity] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && matchResult?.entity_id && !matchResult.is_new_entity) {
      fetchEntityDetails();
    } else if (open && matchResult?.is_new_entity) {
      setEntity(null);
      setError(null);
    }
  }, [open, matchResult?.entity_id]);

  const fetchEntityDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getEntity(profileSlug, matchResult.entity_id);
      setEntity(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    enqueueSnackbar('Copied to clipboard', { variant: 'success' });
  };

  const getFieldConfig = (fieldName) => {
    return profileFields?.find((f) => f.field_name === fieldName);
  };

  if (!matchResult) return null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 700 } } }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="h6" gutterBottom>
                Match Details
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {matchResult.display_name}
              </Typography>
            </Box>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {/* Match Summary */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
              Match Information
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: '40%', border: 0 }}>Match Score</TableCell>
                  <TableCell sx={{ border: 0 }}>
                    <ScoreBadge score={matchResult.match_score} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, border: 0 }}>Match Type</TableCell>
                  <TableCell sx={{ border: 0 }}>
                    <MatchTypeBadge type={matchResult.match_type} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, border: 0 }}>Entity ID</TableCell>
                  <TableCell sx={{ border: 0, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    {matchResult.entity_id ? (
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <span>{matchResult.entity_id}</span>
                        <IconButton size="small" onClick={() => copyToClipboard(matchResult.entity_id)}>
                          <ContentCopyIcon fontSize="inherit" />
                        </IconButton>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">Not created</Typography>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, border: 0 }}>Execution Time</TableCell>
                  <TableCell sx={{ border: 0 }}>
                    {matchResult.execution_ms}ms
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, border: 0 }}>Resolved At</TableCell>
                  <TableCell sx={{ border: 0 }}>
                    {matchResult.resolved_at ? new Date(matchResult.resolved_at).toLocaleString() : '-'}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, border: 0 }}>Flags</TableCell>
                  <TableCell sx={{ border: 0 }}>
                    <Stack direction="row" spacing={1}>
                      {matchResult.is_new_entity && <Chip label="NEW ENTITY" size="small" color="success" />}
                      {matchResult.was_cached && <Chip label="CACHED" size="small" color="info" />}
                      {matchResult.is_authoritative && <Chip label="AUTHORITATIVE" size="small" color="primary" />}
                    </Stack>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Paper>

          {/* Field Score Breakdown */}
          {matchResult.field_scores && Object.keys(matchResult.field_scores).filter(k => k !== '_fastpath').length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                Field Score Breakdown
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    {Object.entries(matchResult.field_scores)
                      .filter(([fieldName]) => fieldName !== '_fastpath')
                      .map(([fieldName, score]) => {
                        const config = getFieldConfig(fieldName);
                        return (
                          <TableRow key={fieldName}>
                            <TableCell sx={{ border: 0, fontWeight: 600 }}>{fieldName}</TableCell>
                            <TableCell sx={{ border: 0 }}>
                              <Stack direction="row" spacing={1} alignItems="center">
                                {config && (
                                  <>
                                    <Chip
                                      label={config.match_strategy}
                                      size="small"
                                      variant="outlined"
                                      sx={{ fontSize: '0.7rem', height: 20 }}
                                    />
                                    <Chip
                                      label={`weight: ${config.weight}`}
                                      size="small"
                                      variant="outlined"
                                      sx={{ fontSize: '0.7rem', height: 20 }}
                                    />
                                  </>
                                )}
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ border: 0 }} align="right">
                              <ScoreBadge score={score} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* Entity Details (if not new entity) */}
          {!matchResult.is_new_entity && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
                Entity Field Values
              </Typography>

              {loading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress size={32} />
                </Box>
              )}

              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  Failed to load entity details: {error}
                </Alert>
              )}

              {entity?.field_values && Object.keys(entity.field_values).length > 0 ? (
                <Stack spacing={2}>
                  {Object.entries(entity.field_values).map(([fieldName, fieldValue]) => {
                    const config = getFieldConfig(fieldName);
                    return (
                      <Box key={fieldName}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {fieldName}
                          </Typography>
                          {config && (
                            <>
                              <Chip
                                label={config.match_strategy}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '0.7rem', height: 20 }}
                              />
                              <Chip
                                label={`weight: ${config.weight}`}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '0.7rem', height: 20 }}
                              />
                            </>
                          )}
                        </Stack>
                        <Paper
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            backgroundColor: 'grey.50',
                            wordBreak: 'break-word',
                          }}
                        >
                          <Typography variant="body2">{fieldValue || '—'}</Typography>
                        </Paper>
                      </Box>
                    );
                  })}
                </Stack>
              ) : (
                !loading && !error && (
                  <Alert severity="info">No entity field values loaded yet</Alert>
                )
              )}
            </Paper>
          )}

          {/* New Entity Info */}
          {matchResult.is_new_entity && (
            <Alert severity="info" icon={<CheckCircleIcon />}>
              This is a new entity that doesn't match any existing records above the threshold. 
              If "Create if missing" was enabled, a new entity would be created in the system.
            </Alert>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
