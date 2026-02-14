import { useState } from 'react';
import {
  Box, TextField, Button, Typography, Divider, Slider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import FieldConfigRow from './FieldConfigRow';

const emptyField = () => ({
  field_name: '',
  field_label: '',
  match_strategy: 'FUZZY',
  weight: 1.0,
  is_required: false,
  is_primary_display: false,
});

export default function ProfileForm({ initial, onSubmit, submitLabel = 'Create Profile', loading }) {
  const [name, setName] = useState(initial?.profile_name || '');
  const [entityType, setEntityType] = useState(initial?.entity_type || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [threshold, setThreshold] = useState(initial?.default_threshold ?? 0.65);
  const [fields, setFields] = useState(
    initial?.fields?.length > 0
      ? initial.fields.map((f) => ({ ...f }))
      : [emptyField()]
  );

  const updateField = (index, updated) => {
    const next = [...fields];
    next[index] = updated;
    setFields(next);
  };

  const removeField = (index) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const addField = () => {
    setFields([...fields, emptyField()]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      profile_name: name,
      entity_type: entityType,
      description: description || null,
      default_threshold: threshold,
      fields: fields.filter((f) => f.field_name),
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          label="Profile Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          sx={{ flex: 1, minWidth: 200 }}
        />
        <TextField
          label="Entity Type"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          required
          placeholder="e.g. Company, Supplier, Person"
          sx={{ flex: 1, minWidth: 200 }}
        />
      </Box>
      <TextField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        fullWidth
        multiline
        rows={2}
        sx={{ mb: 2 }}
      />
      <Box sx={{ mb: 2, maxWidth: 400 }}>
        <Typography variant="body2" gutterBottom>
          Default Threshold: <strong>{threshold.toFixed(2)}</strong>
        </Typography>
        <Slider
          value={threshold}
          onChange={(_, v) => setThreshold(v)}
          min={0}
          max={1}
          step={0.05}
          marks={[{ value: 0.5, label: '0.5' }, { value: 0.65, label: '0.65' }, { value: 0.8, label: '0.8' }]}
          size="small"
        />
      </Box>

      <Divider sx={{ my: 2 }} />

      <Typography variant="h6" gutterBottom>Fields Configuration</Typography>
      {fields.map((field, i) => (
        <FieldConfigRow
          key={i}
          field={field}
          index={i}
          onChange={updateField}
          onRemove={removeField}
          isOnly={fields.length === 1}
        />
      ))}
      <Button startIcon={<AddIcon />} onClick={addField} sx={{ mt: 1, mb: 2 }}>
        Add Field
      </Button>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ textAlign: 'right' }}>
        <Button type="submit" variant="contained" startIcon={<SaveIcon />} disabled={loading} size="large">
          {loading ? 'Saving...' : submitLabel}
        </Button>
      </Box>
    </Box>
  );
}
