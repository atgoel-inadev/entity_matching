import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Typography, Button, Alert, Stack } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import UploadIcon from '@mui/icons-material/Upload';
import { useSnackbar } from 'notistack';
import useProfile from '../hooks/useProfile';
import useEntities from '../hooks/useEntities';
import { bulkLoadEntities, deleteEntity } from '../api/entities';
import EntityTable from '../components/entities/EntityTable';
import EntityDetailDrawer from '../components/entities/EntityDetailDrawer';
import EntityBulkUpload from '../components/entities/EntityBulkUpload';
import ConfirmDialog from '../components/common/ConfirmDialog';
import LoadingOverlay from '../components/common/LoadingOverlay';

export default function EntitiesPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const { profile, loading: profileLoading } = useProfile(slug);
  const { entities, total, loading: entitiesLoading, offset, goToPage, refetch } = useEntities(slug);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState(null);

  const page = Math.floor(offset / 50);

  const handleBulkUpload = async (data) => {
    setUploading(true);
    try {
      const result = await bulkLoadEntities(slug, data);
      enqueueSnackbar(
        `Loaded ${result.total_loaded} entities, ${result.embeddings_generated} embeddings (${result.execution_ms}ms)`,
        { variant: 'success' }
      );
      setUploadOpen(false);
      refetch();
    } catch (err) {
      enqueueSnackbar(err.message, { variant: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEntity(slug, deleteTarget.entity_id);
      enqueueSnackbar('Entity deactivated', { variant: 'success' });
      refetch();
    } catch (err) {
      enqueueSnackbar(err.message, { variant: 'error' });
    }
    setDeleteTarget(null);
  };

  if (profileLoading) return <LoadingOverlay message="Loading profile..." />;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/profiles')} sx={{ mb: 1 }}>
            Back to Profiles
          </Button>
          <Typography variant="h5">Entities: {profile?.profile_name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {profile?.entity_type} &middot; {profile?.entity_count ?? 0} total entities
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<UploadIcon />} onClick={() => setUploadOpen(true)}>
          Bulk Upload
        </Button>
      </Stack>

      {entitiesLoading ? (
        <LoadingOverlay message="Loading entities..." />
      ) : (
        <EntityTable
          entities={entities}
          total={total}
          onDelete={(e) => setDeleteTarget(e)}
          onRowClick={(e) => setSelectedEntity(e)}
          page={page}
          onPageChange={goToPage}
          profileFields={profile?.fields}
        />
      )}

      <EntityDetailDrawer
        entity={selectedEntity}
        open={!!selectedEntity}
        onClose={() => setSelectedEntity(null)}
        profileFields={profile?.fields}
      />

      <EntityBulkUpload
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSubmit={handleBulkUpload}
        loading={uploading}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Entity"
        message={`Are you sure you want to deactivate "${deleteTarget?.display_name}"?`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
