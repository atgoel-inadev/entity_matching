import { useNavigate } from 'react-router-dom';
import { Box, Typography, Button, Grid, Alert } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import useProfiles from '../hooks/useProfiles';
import ProfileCard from '../components/profiles/ProfileCard';
import LoadingOverlay from '../components/common/LoadingOverlay';

export default function ProfilesPage() {
  const navigate = useNavigate();
  const { profiles, loading, error } = useProfiles();

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5">Resolution Profiles</Typography>
          <Typography variant="body2" color="text.secondary">
            Configure matching strategies for different entity types.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/profiles/new')}>
          New Profile
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <LoadingOverlay message="Loading profiles..." />
      ) : (
        <Grid container spacing={3}>
          {profiles.map((p) => (
            <Grid item xs={12} sm={6} md={4} key={p.profile_id}>
              <ProfileCard profile={p} />
            </Grid>
          ))}
          {profiles.length === 0 && (
            <Grid item xs={12}>
              <Alert severity="info">
                No profiles found. Create your first profile to get started.
              </Alert>
            </Grid>
          )}
        </Grid>
      )}
    </Box>
  );
}
