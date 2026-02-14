import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Typography, Card, CardContent, Alert, Button, Stack } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import { useSnackbar } from 'notistack';
import useProfile from '../hooks/useProfile';
import { createProfile, updateProfile, deleteProfile, addField, updateField, deleteField } from '../api/profiles';
import ProfileForm from '../components/profiles/ProfileForm';
import ConfirmDialog from '../components/common/ConfirmDialog';
import LoadingOverlay from '../components/common/LoadingOverlay';

export default function ProfileDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const isNew = slug === 'new';
  const { profile, loading, error } = useProfile(isNew ? null : slug);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleSubmit = async (data) => {
    setSaving(true);
    try {
      if (isNew) {
        const created = await createProfile(data);
        enqueueSnackbar(`Profile "${created.profile_name}" created`, { variant: 'success' });
        navigate(`/profiles/${created.profile_slug}`);
      } else {
        // Update profile metadata
        await updateProfile(slug, {
          profile_name: data.profile_name,
          description: data.description,
          default_threshold: data.default_threshold,
        });

        // Handle field changes
        const originalFields = profile.fields || [];
        const newFields = data.fields || [];

        // Find fields to delete (in original but not in new)
        const originalFieldNames = originalFields.map(f => f.field_name);
        const newFieldNames = newFields.map(f => f.field_name);
        const fieldsToDelete = originalFieldNames.filter(name => !newFieldNames.includes(name));

        // Find fields to add (in new but not in original)
        const fieldsToAdd = newFields.filter(f => !originalFieldNames.includes(f.field_name));

        // Find fields to update (in both, but with changes)
        const fieldsToUpdate = newFields.filter(f => {
          const original = originalFields.find(of => of.field_name === f.field_name);
          if (!original) return false;
          // Check if any field property changed
          return (
            original.field_label !== f.field_label ||
            original.match_strategy !== f.match_strategy ||
            original.weight !== f.weight ||
            original.is_required !== f.is_required ||
            original.is_primary_display !== f.is_primary_display
          );
        });

        // Execute field operations
        const fieldOps = [];
        
        for (const fieldName of fieldsToDelete) {
          fieldOps.push(deleteField(slug, fieldName));
        }

        for (const field of fieldsToAdd) {
          fieldOps.push(addField(slug, field));
        }

        for (const field of fieldsToUpdate) {
          fieldOps.push(updateField(slug, field.field_name, {
            field_label: field.field_label,
            match_strategy: field.match_strategy,
            weight: field.weight,
            is_required: field.is_required,
          }));
        }

        if (fieldOps.length > 0) {
          await Promise.all(fieldOps);
        }

        enqueueSnackbar('Profile updated successfully', { variant: 'success' });
        // Reload profile data
        window.location.reload();
      }
    } catch (err) {
      enqueueSnackbar(err.message || 'Failed to update profile', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProfile(slug);
      enqueueSnackbar('Profile deactivated', { variant: 'success' });
      navigate('/profiles');
    } catch (err) {
      enqueueSnackbar(err.message, { variant: 'error' });
    }
    setDeleteOpen(false);
  };

  if (!isNew && loading) return <LoadingOverlay message="Loading profile..." />;
  if (!isNew && error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/profiles')} sx={{ mb: 1 }}>
            Back to Profiles
          </Button>
          <Typography variant="h5">{isNew ? 'Create New Profile' : `Edit: ${profile?.profile_name}`}</Typography>
        </Box>
        {!isNew && (
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteOpen(true)}>
            Deactivate
          </Button>
        )}
      </Stack>

      <Card>
        <CardContent>
          <ProfileForm
            initial={isNew ? null : profile}
            onSubmit={handleSubmit}
            submitLabel={isNew ? 'Create Profile' : 'Update Profile'}
            loading={saving}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        title="Deactivate Profile"
        message={`Are you sure you want to deactivate "${profile?.profile_name}"? This will soft-delete the profile and its entities.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </Box>
  );
}
