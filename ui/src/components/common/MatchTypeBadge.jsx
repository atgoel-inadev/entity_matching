import { Chip } from '@mui/material';

const TYPE_COLORS = {
  EXACT: 'success',
  EXACT_ALL: 'success',
  EXACT_FASTPATH: 'success',
  SEMANTIC: 'primary',
  FUZZY: 'warning',
  PHONETIC: 'warning',
  COMPOSITE: 'secondary',
  HYBRID_HIGH: 'info',
  NEW_ENTITY: 'default',
};

export default function MatchTypeBadge({ type }) {
  if (!type) return null;
  return (
    <Chip
      label={type.replace(/_/g, ' ')}
      color={TYPE_COLORS[type] || 'default'}
      size="small"
    />
  );
}
