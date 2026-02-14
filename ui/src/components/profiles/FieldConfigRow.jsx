import {
  Box, TextField, Select, MenuItem, FormControl, InputLabel,
  Checkbox, FormControlLabel, IconButton, Paper,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

const STRATEGIES = ['EXACT', 'FUZZY', 'SEMANTIC', 'PHONETIC', 'NUMERIC', 'HYBRID', 'NONE'];

export default function FieldConfigRow({ field, index, onChange, onRemove, isOnly }) {
  const update = (key, value) => {
    onChange(index, { ...field, [key]: value });
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
      <TextField
        label="Field Name"
        value={field.field_name || ''}
        onChange={(e) => update('field_name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
        size="small"
        sx={{ flex: 1, minWidth: 120 }}
        required
      />
      <TextField
        label="Label"
        value={field.field_label || ''}
        onChange={(e) => update('field_label', e.target.value)}
        size="small"
        sx={{ flex: 1, minWidth: 120 }}
      />
      <FormControl size="small" sx={{ minWidth: 120 }}>
        <InputLabel>Strategy</InputLabel>
        <Select
          value={field.match_strategy || 'FUZZY'}
          label="Strategy"
          onChange={(e) => update('match_strategy', e.target.value)}
        >
          {STRATEGIES.map((s) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        label="Weight"
        type="number"
        value={field.weight ?? 1}
        onChange={(e) => update('weight', parseFloat(e.target.value) || 0)}
        size="small"
        sx={{ width: 80 }}
        inputProps={{ min: 0, max: 10, step: 0.5 }}
      />
      <FormControlLabel
        control={<Checkbox checked={field.is_required || false} onChange={(e) => update('is_required', e.target.checked)} size="small" />}
        label="Required"
      />
      <FormControlLabel
        control={<Checkbox checked={field.is_primary_display || false} onChange={(e) => update('is_primary_display', e.target.checked)} size="small" />}
        label="Display"
      />
      <IconButton onClick={() => onRemove(index)} disabled={isOnly} color="error" size="small">
        <DeleteIcon />
      </IconButton>
    </Paper>
  );
}
