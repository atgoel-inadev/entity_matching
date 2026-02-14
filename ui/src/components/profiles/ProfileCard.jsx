import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardActions, Typography, Button, Chip, Stack, Box } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import StorageIcon from '@mui/icons-material/Storage';
import SearchIcon from '@mui/icons-material/Search';

export default function ProfileCard({ profile }) {
  const navigate = useNavigate();

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
          <Typography variant="h6">{profile.profile_name}</Typography>
          <Chip
            label={profile.is_active ? 'Active' : 'Inactive'}
            color={profile.is_active ? 'success' : 'default'}
            size="small"
          />
        </Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {profile.description || profile.entity_type}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
          <Chip label={`Type: ${profile.entity_type}`} size="small" variant="outlined" />
          <Chip label={`${profile.fields?.length || 0} fields`} size="small" variant="outlined" icon={<TuneIcon />} />
          <Chip label={`${profile.entity_count ?? 0} entities`} size="small" variant="outlined" icon={<StorageIcon />} />
          <Chip label={`Threshold: ${profile.default_threshold}`} size="small" variant="outlined" color="primary" />
        </Stack>
      </CardContent>
      <CardActions>
        <Button size="small" onClick={() => navigate(`/profiles/${profile.profile_slug}`)}>
          Configure
        </Button>
        <Button size="small" onClick={() => navigate(`/profiles/${profile.profile_slug}/entities`)}>
          Entities
        </Button>
        <Button size="small" color="primary" onClick={() => navigate(`/resolve/${profile.profile_slug}`)}>
          Resolve
        </Button>
      </CardActions>
    </Card>
  );
}
