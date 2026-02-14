import { Box, Slider, Typography } from '@mui/material';

const marks = [
  { value: 0.3, label: '0.3' },
  { value: 0.5, label: '0.5' },
  { value: 0.65, label: '0.65' },
  { value: 0.8, label: '0.8' },
  { value: 0.95, label: '0.95' },
];

export default function ThresholdSlider({ value, onChange }) {
  return (
    <Box>
      <Typography variant="body2" gutterBottom>
        Match Threshold: <strong>{value.toFixed(2)}</strong>
      </Typography>
      <Slider
        value={value}
        onChange={(_, v) => onChange(v)}
        min={0}
        max={1}
        step={0.01}
        marks={marks}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
        size="small"
      />
    </Box>
  );
}
