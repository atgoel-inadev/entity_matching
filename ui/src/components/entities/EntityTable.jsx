import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, IconButton, Chip, Typography, TablePagination,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

export default function EntityTable({ entities, total, onDelete, onRowClick, page, onPageChange, profileFields }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Display Name</TableCell>
            <TableCell>Entity ID</TableCell>
            <TableCell>Fields</TableCell>
            <TableCell>Created</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entities.map((e) => (
            <TableRow
              key={e.entity_id}
              hover
              onClick={() => onRowClick && onRowClick(e)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell>
                <Typography variant="body2" fontWeight={600}>{e.display_name}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="caption" fontFamily="monospace">{e.entity_id.slice(0, 12)}...</Typography>
              </TableCell>
              <TableCell>
                {e.field_values && Object.entries(e.field_values).slice(0, 3).map(([k, v]) => (
                  <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
                ))}
                {e.field_values && Object.keys(e.field_values).length > 3 && (
                  <Chip label={`+${Object.keys(e.field_values).length - 3} more`} size="small" />
                )}
              </TableCell>
              <TableCell>
                <Typography variant="caption">{e.created_at?.slice(0, 10) || '-'}</Typography>
              </TableCell>
              <TableCell align="right">
                <IconButton
                  size="small"
                  color="error"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(e);
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
          {entities.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} align="center">
                <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                  No entities found. Load seed data or bulk upload entities.
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={total || 0}
        rowsPerPage={50}
        page={page}
        onPageChange={(_, p) => onPageChange(p)}
        rowsPerPageOptions={[50]}
      />
    </TableContainer>
  );
}
