import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, Alert, Box,
} from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';

const EXAMPLE = `[
  {
    "fields": { "name": "Acme Corp", "city": "Chicago" },
    "display_name": "Acme Corporation"
  },
  {
    "fields": { "name": "Widget Inc", "city": "Boston" }
  }
]`;

export default function EntityBulkUpload({ open, onClose, onSubmit, loading }) {
  const [json, setJson] = useState('');
  const [error, setError] = useState(null);
  const [count, setCount] = useState(0);

  const handleJsonChange = (val) => {
    setJson(val);
    setError(null);
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        setCount(parsed.length);
      } else {
        setError('JSON must be an array of entity objects');
        setCount(0);
      }
    } catch {
      setCount(0);
    }
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => handleJsonChange(evt.target.result);
    reader.readAsText(file);
  };

  const handleSubmit = () => {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setError('JSON must be a non-empty array');
        return;
      }
      onSubmit(parsed);
    } catch {
      setError('Invalid JSON');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Bulk Upload Entities</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Paste a JSON array of entities or upload a .json file. Each entity needs a "fields" object.
        </Typography>

        <Button component="label" variant="outlined" startIcon={<UploadIcon />} sx={{ mb: 2 }}>
          Upload JSON File
          <input type="file" hidden accept=".json" onChange={handleFile} />
        </Button>

        <TextField
          label="JSON Entities"
          value={json}
          onChange={(e) => handleJsonChange(e.target.value)}
          multiline
          rows={12}
          fullWidth
          placeholder={EXAMPLE}
          sx={{ fontFamily: 'monospace' }}
        />

        {count > 0 && (
          <Typography variant="body2" sx={{ mt: 1 }} color="success.main">
            {count} entities ready to upload
          </Typography>
        )}
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading || count === 0}>
          {loading ? 'Uploading...' : `Upload ${count} Entities`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
