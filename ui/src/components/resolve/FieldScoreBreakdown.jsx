import { Box } from '@mui/material';
import ScoreBar from '../common/ScoreBar';

export default function FieldScoreBreakdown({ fieldScores, profileFields }) {
  if (!fieldScores || Object.keys(fieldScores).length === 0) return null;

  const fieldMap = {};
  if (profileFields) {
    profileFields.forEach((f) => { fieldMap[f.field_name] = f; });
  }

  return (
    <Box sx={{ pl: 2, pr: 2, py: 1 }}>
      {Object.entries(fieldScores)
        .filter(([key]) => key !== '_fastpath')
        .sort(([, a], [, b]) => b - a)
        .map(([name, score]) => (
          <ScoreBar
            key={name}
            label={fieldMap[name]?.field_label || name}
            score={score}
            strategy={fieldMap[name]?.match_strategy}
          />
        ))}
    </Box>
  );
}
