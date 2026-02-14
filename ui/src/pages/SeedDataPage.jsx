import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Tabs, Tab,
  Grid, Chip, Stack, Alert, Accordion, AccordionSummary,
  AccordionDetails, CircularProgress, IconButton, Tooltip,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DataObjectIcon from '@mui/icons-material/DataObject';
import { useSnackbar } from 'notistack';
import { listProfiles } from '../api/profiles';
import { listEntities, bulkLoadEntities, updateEntity, deleteEntity } from '../api/entities';
import CsvUploadDialog from '../components/entities/CsvUploadDialog';
import EntityDataGrid from '../components/entities/EntityDataGrid';

export default function SeedDataPage() {
  const { enqueueSnackbar } = useSnackbar();
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const data = await listProfiles(true);
      setProfiles(data || []);
      if (data && data.length > 0) {
        setSelectedProfile(data[0]);
        loadEntities(data[0].profile_slug);
      }
    } catch (err) {
      enqueueSnackbar(`Error loading profiles: ${err.message}`, { variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const loadEntities = async (slug) => {
    try {
      const data = await listEntities(slug, 500, 0);
      setEntities(data || []);
    } catch (err) {
      enqueueSnackbar(`Error loading entities: ${err.message}`, { variant: 'error' });
      setEntities([]);
    }
  };

  const handleProfileSelect = (profile) => {
    setSelectedProfile(profile);
    loadEntities(profile.profile_slug);
    setSelectedTab(0);
  };

  const handleUploadCsv = async (validEntities) => {
    if (!selectedProfile) return;

    try {
      setUploading(true);
      const result = await bulkLoadEntities(selectedProfile.profile_slug, validEntities);
      enqueueSnackbar(
        `✓ Loaded ${result.total_loaded} entities, generated ${result.embeddings_generated} embeddings (${result.execution_ms}ms)`,
        { variant: 'success' }
      );
      setUploadDialogOpen(false);
      loadEntities(selectedProfile.profile_slug);
    } catch (err) {
      enqueueSnackbar(`Upload failed: ${err.message}`, { variant: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateEntity = async (entityId, data) => {
    try {
      await updateEntity(selectedProfile.profile_slug, entityId, data);
      enqueueSnackbar('Entity updated successfully', { variant: 'success' });
      loadEntities(selectedProfile.profile_slug);
    } catch (err) {
      enqueueSnackbar(`Update failed: ${err.message}`, { variant: 'error' });
    }
  };

  const handleDeleteEntity = async (entityId) => {
    try {
      await deleteEntity(selectedProfile.profile_slug, entityId);
      enqueueSnackbar('Entity deleted successfully', { variant: 'success' });
      loadEntities(selectedProfile.profile_slug);
    } catch (err) {
      enqueueSnackbar(`Delete failed: ${err.message}`, { variant: 'error' });
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (profiles.length === 0) {
    return (
      <Box>
        <Alert severity="info">
          No profiles found. Create a profile first from the Profiles page.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5">Seed Data Management</Typography>
          <Typography variant="body2" color="text.secondary">
            Upload and manage entity data for configured profiles via CSV
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh data">
            <IconButton onClick={() => loadEntities(selectedProfile.profile_slug)}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          {selectedProfile && (
            <Button
              variant="contained"
              startIcon={<UploadFileIcon />}
              onClick={() => setUploadDialogOpen(true)}
            >
              Upload CSV
            </Button>
          )}
        </Stack>
      </Box>

      <Grid container spacing={3}>
        {/* Profile Selection Sidebar */}
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Available Profiles
              </Typography>
              <Grid container spacing={1}>
                {profiles.map((profile) => (
                  <Grid item xs={12} sm={6} key={profile.profile_id}>
                    <Card
                      variant={selectedProfile?.profile_id === profile.profile_id ? 'elevation' : 'outlined'}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: selectedProfile?.profile_id === profile.profile_id
                          ? 'primary.light'
                          : 'transparent',
                        height: '100%',
                      }}
                      onClick={() => handleProfileSelect(profile)}
                    >
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Typography variant="subtitle2">{profile.profile_name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {profile.entity_type}
                        </Typography>
                        <Box sx={{ mt: 0.5 }}>
                          <Chip label={`${profile.entity_count || 0} entities`} size="small" />
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Main Content Area */}
        <Grid item xs={12} md={9}>
          {selectedProfile && (
            <Card>
              <CardContent>
                <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                  <Tabs value={selectedTab} onChange={(e, v) => setSelectedTab(v)}>
                    <Tab label="Entity Data" />
                    <Tab label="Profile Configuration" />
                  </Tabs>
                </Box>

                {selectedTab === 0 && (
                  <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="h6">
                        {selectedProfile.profile_name} Entities ({entities.length})
                      </Typography>
                    </Box>

                    <EntityDataGrid
                      entities={entities}
                      profile={selectedProfile}
                      onUpdate={handleUpdateEntity}
                      onDelete={handleDeleteEntity}
                    />
                  </Box>
                )}

                {selectedTab === 1 && (
                  <Box>
                    <Stack spacing={2}>
                      <Box>
                        <Typography variant="subtitle2" gutterBottom>
                          Profile Details
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {selectedProfile.description}
                        </Typography>
                        <Box sx={{ mt: 1 }}>
                          <Chip label={`Threshold: ${selectedProfile.default_threshold}`} size="small" sx={{ mr: 1 }} />
                          <Chip label={`Entity Type: ${selectedProfile.entity_type}`} size="small" />
                        </Box>
                      </Box>

                      <Accordion defaultExpanded>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Typography variant="subtitle2">
                            Field Configuration ({selectedProfile.fields?.length || 0} fields)
                          </Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                          <Stack spacing={1}>
                            {selectedProfile.fields?.map((field) => (
                              <Card key={field.field_name} variant="outlined">
                                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Box>
                                      <Typography variant="body2" fontWeight="medium">
                                        {field.field_label || field.field_name}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {field.field_name}
                                      </Typography>
                                    </Box>
                                    <Stack direction="row" spacing={0.5}>
                                      <Chip label={field.match_strategy} size="small" color="primary" />
                                      <Chip label={`Weight: ${field.weight}`} size="small" />
                                      {field.is_required && <Chip label="Required" size="small" color="error" />}
                                      {field.is_primary_display && <Chip label="Display" size="small" color="success" />}
                                    </Stack>
                                  </Box>
                                </CardContent>
                              </Card>
                            ))}
                          </Stack>
                        </AccordionDetails>
                      </Accordion>

                      <Alert severity="info" icon={<DataObjectIcon />}>
                        <Typography variant="body2">
                          <strong>CSV Upload Format:</strong> Your CSV must include columns for all required fields (marked in red above).
                          Embeddings will be automatically generated for SEMANTIC and HYBRID strategy fields.
                        </Typography>
                      </Alert>
                    </Stack>
                  </Box>
                )}
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>

      {/* CSV Upload Dialog */}
      {selectedProfile && (
        <CsvUploadDialog
          open={uploadDialogOpen}
          onClose={() => setUploadDialogOpen(false)}
          profile={selectedProfile}
          onSubmit={handleUploadCsv}
          loading={uploading}
        />
      )}
    </Box>
  );
}
