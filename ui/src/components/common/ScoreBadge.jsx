import { Chip } from '@mui/material';

export default function ScoreBadge({ score }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  let color = 'error';
  if (score >= 0.8) color = 'success';
  else if (score >= 0.5) color = 'warning';

  return <Chip label={`${pct}%`} color={color} size="small" variant="outlined" />;
}
