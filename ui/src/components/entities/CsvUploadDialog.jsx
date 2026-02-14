import { useState, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Alert, Box, Stepper, Step, StepLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Chip, IconButton, Tooltip,
} from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { parse as parseCsv } from 'papaparse';

export default function CsvUploadDialog({ open, onClose, profile, onSubmit, loading }) {
  const [activeStep, setActiveStep] = useState(0);
  const [csvData, setCsvData] = useState([]);
  const [errors, setErrors] = useState([]);
  const [validEntities, setValidEntities] = useState([]);

  const handleFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    parseCsv(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setCsvData(results.data);
        validateData(results.data);
        setActiveStep(1);
      },
      error: (error) => {
        setErrors([`CSV parsing error: ${error.message}`]);
      },
    });
  }, [profile]);

  const validateData = (data) => {
    const requiredFields = profile.fields
      .filter((f) => f.is_required)
      .map((f) => f.field_name);
    
    const allFieldNames = profile.fields.map((f) => f.field_name);
    const validationErrors = [];
    const entities = [];

    data.forEach((row, index) => {
      const rowErrors = [];
      
      // Check required fields
      requiredFields.forEach((fieldName) => {
        if (!row[fieldName] || row[fieldName].trim() === '') {
          rowErrors.push(`Missing required field: ${fieldName}`);
        }
      });

      // Extract only configured fields
      const fields = {};
      allFieldNames.forEach((fieldName) => {
        if (row[fieldName] !== undefined && row[fieldName] !== null && row[fieldName] !== '') {
          fields[fieldName] = row[fieldName];
        }
      });

      // Determine display_name
      const displayField = profile.fields.find((f) => f.is_primary_display);
      const display_name = displayField && fields[displayField.field_name]
        ? fields[displayField.field_name]
        : Object.values(fields)[0] || 'Unknown';

      if (rowErrors.length > 0) {
        validationErrors.push({ row: index + 1, errors: rowErrors, data: row });
      } else {
        entities.push({
          fields: fields,
          display_name,
        });
      }
    });

    setErrors(validationErrors);
    setValidEntities(entities);
  };

  const handleSubmit = () => {
    onSubmit(validEntities);
  };

  const handleBack = () => {
    setActiveStep(0);
    setCsvData([]);
    setErrors([]);
    setValidEntities([]);
  };

  const handleCloseDialog = () => {
    handleBack();
    onClose();
  };

  const steps = ['Upload CSV', 'Validate', 'Confirm'];

  return (
    <Dialog open={open} onClose={handleCloseDialog} maxWidth="lg" fullWidth>
      <DialogTitle>
        Upload CSV Data for {profile?.profile_name}
      </DialogTitle>
      
      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {activeStep === 0 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload a CSV file matching the profile field configuration:
            </Typography>
            
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Required CSV Columns:</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {profile?.fields.map((field) => (
                  <Chip
                    key={field.field_name}
                    label={field.field_name}
                    size="small"
                    color={field.is_required ? 'primary' : 'default'}
                    icon={field.is_required ? <CheckCircleIcon /> : undefined}
                  />
                ))}
              </Box>
              <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                * Blue chips are required fields
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle2" gutterBottom>Example CSV Format:</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>
                {profile?.fields.map((f) => f.field_name).join(',')}{'\n'}
                {profile?.fields.map((f) => `"Sample ${f.field_label}"`).join(',')}
              </Typography>
            </Paper>

            <Button
              component="label"
              variant="contained"
              startIcon={<UploadIcon />}
              fullWidth
              size="large"
            >
              Select CSV File
              <input type="file" hidden accept=".csv" onChange={handleFileUpload} />
            </Button>
          </Box>
        )}

        {activeStep === 1 && (
          <Box>
            {errors.length > 0 && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <Typography variant="subtitle2">
                  Found {errors.length} validation errors:
                </Typography>
                <Box sx={{ maxHeight: 200, overflow: 'auto', mt: 1 }}>
                  {errors.map((err, i) => (
                    <Typography key={i} variant="caption" display="block">
                      Row {err.row}: {err.errors.join(', ')}
                    </Typography>
                  ))}
                </Box>
              </Alert>
            )}

            {validEntities.length > 0 && (
              <Alert severity="success" sx={{ mb: 2 }}>
                ✓ {validEntities.length} valid entities ready to upload
              </Alert>
            )}

            <Typography variant="subtitle2" gutterBottom>
              Preview (first 10 rows):
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Status</TableCell>
                    {profile?.fields.map((field) => (
                      <TableCell key={field.field_name}>{field.field_label}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {csvData.slice(0, 10).map((row, index) => {
                    const hasError = errors.some((e) => e.row === index + 1);
                    return (
                      <TableRow key={index} sx={{ bgcolor: hasError ? 'error.light' : 'transparent' }}>
                        <TableCell>
                          {hasError ? (
                            <Tooltip title={errors.find((e) => e.row === index + 1)?.errors.join(', ')}>
                              <ErrorIcon color="error" fontSize="small" />
                            </Tooltip>
                          ) : (
                            <CheckCircleIcon color="success" fontSize="small" />
                          )}
                        </TableCell>
                        {profile?.fields.map((field) => (
                          <TableCell key={field.field_name}>
                            {row[field.field_name] || '-'}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            {csvData.length > 10 && (
              <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                Showing 10 of {csvData.length} rows
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleCloseDialog}>Cancel</Button>
        {activeStep === 1 && (
          <>
            <Button onClick={handleBack}>Back</Button>
            <Button
              onClick={handleSubmit}
              variant="contained"
              disabled={loading || validEntities.length === 0}
              startIcon={loading ? null : <UploadIcon />}
            >
              {loading ? 'Uploading...' : `Upload ${validEntities.length} Entities`}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
