import { Box, TextField, Chip, Grid } from '@mui/material';

const STRATEGY_COLORS = {
  EXACT: 'success',
  FUZZY: 'warning',
  SEMANTIC: 'primary',
  PHONETIC: 'info',
  NUMERIC: 'secondary',
  NONE: 'default',
};

export default function DynamicFieldForm({ fields, values, onChange }) {
  if (!fields || fields.length === 0) return null;

  const handleChange = (fieldName, val) => {
    onChange({ ...values, [fieldName]: val });
  };

  return (
    <Grid container spacing={2}>
      {fields
        .filter((f) => f.match_strategy !== 'NONE')
        .map((field) => (
          <Grid item xs={12} sm={6} key={field.field_name}>
            <TextField
              label={field.field_label || field.field_name}
              value={values[field.field_name] || ''}
              onChange={(e) => handleChange(field.field_name, e.target.value)}
              required={field.is_required}
              fullWidth
              size="small"
              helperText={
                <Box component="span" sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.25 }}>
                  <Chip
                    label={field.match_strategy}
                    color={STRATEGY_COLORS[field.match_strategy] || 'default'}
                    size="small"
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.65rem' }}
                  />
                  <span>weight: {field.weight}</span>
                </Box>
              }
            />
          </Grid>
        ))}
    </Grid>
  );
}
