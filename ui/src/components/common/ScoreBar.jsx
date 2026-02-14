import { Box, LinearProgress, Typography } from '@mui/material';

export default function ScoreBar({ label, score, strategy }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  let color = 'error';
  if (score >= 0.8) color = 'success';
  else if (score >= 0.5) color = 'warning';

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
      <Typography variant="body2" sx={{ minWidth: 100, fontWeight: 500 }}>
        {label}
      </Typography>
      {strategy && (
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70 }}>
          {strategy}
        </Typography>
      )}
      <Box sx={{ flexGrow: 1 }}>
        <LinearProgress variant="determinate" value={pct} color={color} sx={{ height: 8, borderRadius: 4 }} />
      </Box>
      <Typography variant="body2" sx={{ minWidth: 40, textAlign: 'right', fontWeight: 600 }}>
        {pct}%
      </Typography>
    </Box>
  );
}
