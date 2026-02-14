import { useState } from 'react';
import {
  Box, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Tooltip, Chip, TextField,
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';

export default function EntityDataGrid({ entities, profile, onUpdate, onDelete, readonly = false }) {
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const handleEdit = (entity) => {
    setEditingId(entity.entity_id);
    setEditValues(entity.field_values || {});
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const handleSave = async (entityId) => {
    const displayField = profile.fields.find((f) => f.is_primary_display);
    const display_name = displayField && editValues[displayField.field_name]
      ? editValues[displayField.field_name]
      : Object.values(editValues)[0] || 'Unknown';

    await onUpdate(entityId, {
      fields: editValues,
      display_name,
    });
    handleCancelEdit();
  };

  const handleDelete = async (entityId) => {
    await onDelete(entityId);
    setDeleteConfirm(null);
  };

  const updateEditValue = (fieldName, value) => {
    setEditValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  return (
    <>
      <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>Display Name</TableCell>
              {profile.fields.map((field) => (
                <TableCell key={field.field_name}>
                  {field.field_label}
                  {field.is_required && ' *'}
                </TableCell>
              ))}
              <TableCell>Strategy</TableCell>
              {!readonly && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {entities.length === 0 && (
              <TableRow>
                <TableCell colSpan={profile.fields.length + 3} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    No entities found. Upload CSV data to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {entities.map((entity) => {
              const isEditing = editingId === entity.entity_id;
              return (
                <TableRow key={entity.entity_id} hover={!isEditing}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      {entity.display_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {entity.entity_id.slice(0, 8)}...
                    </Typography>
                  </TableCell>
                  {profile.fields.map((field) => (
                    <TableCell key={field.field_name}>
                      {isEditing ? (
                        <TextField
                          size="small"
                          value={editValues[field.field_name] || ''}
                          onChange={(e) => updateEditValue(field.field_name, e.target.value)}
                          fullWidth
                          required={field.is_required}
                        />
                      ) : (
                        entity.field_values?.[field.field_name] || '-'
                      )}
                    </TableCell>
                  ))}
                  <TableCell>
                    {profile.fields.map((field) => (
                      <Chip
                        key={field.field_name}
                        label={field.match_strategy}
                        size="small"
                        sx={{ mr: 0.5, mb: 0.5 }}
                      />
                    ))}
                  </TableCell>
                  {!readonly && (
                    <TableCell align="right">
                      {isEditing ? (
                        <>
                          <Tooltip title="Save">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => handleSave(entity.entity_id)}
                            >
                              <SaveIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Cancel">
                            <IconButton size="small" onClick={handleCancelEdit}>
                              <CancelIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      ) : (
                        <>
                          <Tooltip title="Edit">
                            <IconButton
                              size="small"
                              onClick={() => handleEdit(entity)}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setDeleteConfirm(entity)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete entity "{deleteConfirm?.display_name}"?
          </Typography>
          <Typography variant="caption" color="text.secondary">
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            onClick={() => handleDelete(deleteConfirm.entity_id)}
            color="error"
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
