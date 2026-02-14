import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Grid, Card, CardContent, CardActions, Button,
  Chip, Alert, Stack,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import TuneIcon from '@mui/icons-material/Tune';
import SearchIcon from '@mui/icons-material/Search';
import StorageIcon from '@mui/icons-material/Storage';
import SpeedIcon from '@mui/icons-material/Speed';
import { healthCheck, getStats } from '../api/health';
import useProfiles from '../hooks/useProfiles';
import LoadingOverlay from '../components/common/LoadingOverlay';

function StatCard({ title, value, subtitle, icon, color = 'primary' }) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="body2" color="text.secondary">{title}</Typography>
            <Typography variant="h4" color={`${color}.main`} sx={{ mt: 0.5 }}>{value}</Typography>
            {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
          </Box>
          <Box sx={{ color: `${color}.main`, opacity: 0.5 }}>{icon}</Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { profiles, loading: profilesLoading } = useProfiles();
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    healthCheck()
      .then(setHealth)
      .catch((err) => setError(err.message));

    getStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  const totalEntities = profiles.reduce((sum, p) => sum + (p.entity_count || 0), 0);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Dashboard</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        ResolveIQ Entity Resolution Engine
      </Typography>

      {/* Health Status */}
      {health && (
        <Alert
          severity={health.status === 'healthy' ? 'success' : 'warning'}
          icon={health.status === 'healthy' ? <CheckCircleIcon /> : <ErrorIcon />}
          sx={{ mb: 3 }}
        >
          System Status: {health.status?.toUpperCase()}
          {health.components && (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              {Object.entries(health.components).map(([k, v]) => (
                <Chip
                  key={k}
                  label={`${k}: ${v}`}
                  size="small"
                  color={v === 'connected' ? 'success' : 'warning'}
                  variant="outlined"
                />
              ))}
            </Stack>
          )}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Active Profiles"
            value={profilesLoading ? '...' : profiles.filter((p) => p.is_active).length}
            subtitle="Configured entity types"
            icon={<TuneIcon sx={{ fontSize: 40 }} />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Entities"
            value={profilesLoading ? '...' : totalEntities.toLocaleString()}
            subtitle="Across all profiles"
            icon={<StorageIcon sx={{ fontSize: 40 }} />}
            color="secondary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Queries Today"
            value={stats?.performance?.queries_today ?? '-'}
            subtitle={stats?.performance?.cache_hit_rate_pct != null ? `${stats.performance.cache_hit_rate_pct}% cache hit` : ''}
            icon={<SearchIcon sx={{ fontSize: 40 }} />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Avg Latency"
            value={stats?.performance?.avg_latency_ms != null ? `${Math.round(stats.performance.avg_latency_ms)}ms` : '-'}
            subtitle={stats?.performance?.p95_latency_ms != null ? `P95: ${Math.round(stats.performance.p95_latency_ms)}ms` : ''}
            icon={<SpeedIcon sx={{ fontSize: 40 }} />}
            color="warning"
          />
        </Grid>
      </Grid>

      {/* Quick Actions */}
      <Typography variant="h6" gutterBottom>Quick Actions</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1">Resolve Entity</Typography>
              <Typography variant="body2" color="text.secondary">
                Match an entity against existing records
              </Typography>
            </CardContent>
            <CardActions>
              <Button onClick={() => navigate('/resolve')}>Go to Resolve</Button>
            </CardActions>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1">Manage Profiles</Typography>
              <Typography variant="body2" color="text.secondary">
                Configure matching strategies and fields
              </Typography>
            </CardContent>
            <CardActions>
              <Button onClick={() => navigate('/profiles')}>View Profiles</Button>
            </CardActions>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1">Load Seed Data</Typography>
              <Typography variant="body2" color="text.secondary">
                Quick-start with pre-configured profiles
              </Typography>
            </CardContent>
            <CardActions>
              <Button onClick={() => navigate('/seed')}>Seed Data</Button>
            </CardActions>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
