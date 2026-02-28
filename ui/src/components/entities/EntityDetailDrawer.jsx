import {
  Drawer, Box, Typography, IconButton, Stack, Divider, Chip, Table, TableBody,
  TableRow, TableCell, Paper, Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useSnackbar } from 'notistack';

export default function EntityDetailDrawer({ entity, open, onClose, profileFields }) {
  const { enqueueSnackbar } = useSnackbar();

  if (!entity) return null;

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    enqueueSnackbar('Copied to clipboard', { variant: 'success' });
  };

  const getFieldConfig = (fieldName) => {
    return profileFields?.find((f) => f.field_name === fieldName);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 600 } } }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="h6" gutterBottom>
                Entity Details
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {entity.display_name}
              </Typography>
            </Box>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {/* System Fields */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
              System Information
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: '40%', border: 0 }}>Entity ID</TableCell>
                  <TableCell sx={{ border: 0, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <span>{entity.entity_id}</span>
                      <IconButton size="small" onClick={() => copyToClipboard(entity.entity_id)}>
                        <ContentCopyIcon fontSize="inherit" />
                      </IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, border: 0 }}>Profile ID</TableCell>
                  <TableCell sx={{ border: 0, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    {entity.profile_id}
                  </TableCell>
                </TableRow>
                {entity.external_id && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, border: 0 }}>External ID</TableCell>
                    <TableCell sx={{ border: 0, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {entity.external_id}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, border: 0 }}>Status</TableCell>
                  <TableCell sx={{ border: 0 }}>
                    <Chip
                      label={entity.is_active ? 'Active' : 'Inactive'}
                      size="small"
                      color={entity.is_active ? 'success' : 'default'}
                    />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, border: 0 }}>Created</TableCell>
                  <TableCell sx={{ border: 0 }}>
                    {new Date(entity.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
                {entity.updated_at && entity.updated_at !== entity.created_at && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, border: 0 }}>Updated</TableCell>
                    <TableCell sx={{ border: 0 }}>
                      {new Date(entity.updated_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>

          {/* Field Values */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
              Field Values ({Object.keys(entity.field_values || {}).length})
            </Typography>

            {entity.field_values && Object.keys(entity.field_values).length > 0 ? (
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
              <Alert severity="info">No field values available</Alert>
            )}
          </Paper>
        </Box>
      </Box>
    </Drawer>
  );
}
