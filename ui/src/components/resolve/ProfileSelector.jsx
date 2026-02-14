import { Autocomplete, TextField, Box, Typography, Chip } from '@mui/material';

export default function ProfileSelector({ profiles, value, onChange, loading }) {
  return (
    <Autocomplete
      options={profiles}
      value={value}
      onChange={(_, newVal) => onChange(newVal)}
      loading={loading}
      getOptionLabel={(opt) => opt.profile_name || ''}
      isOptionEqualToValue={(opt, val) => opt.profile_slug === val?.profile_slug}
      renderOption={(props, opt) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Box>
              <Typography variant="body1">{opt.profile_name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {opt.entity_type} &middot; {opt.fields?.length || 0} fields &middot; {opt.entity_count ?? 0} entities
              </Typography>
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label="Select Profile" placeholder="Search profiles..." />
      )}
      fullWidth
    />
  );
}
