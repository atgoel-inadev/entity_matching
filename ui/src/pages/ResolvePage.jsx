import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, Button, Checkbox, FormControlLabel,
  Alert, Divider, Chip, Stack,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FindInPageIcon from '@mui/icons-material/FindInPage';
import useProfiles from '../hooks/useProfiles';
import useProfile from '../hooks/useProfile';
import { resolveEntity, findSimilarEntities } from '../api/resolve';
import ProfileSelector from '../components/resolve/ProfileSelector';
import DynamicFieldForm from '../components/resolve/DynamicFieldForm';
import ThresholdSlider from '../components/resolve/ThresholdSlider';
import ResultsTable from '../components/resolve/ResultsTable';
import LoadingOverlay from '../components/common/LoadingOverlay';

export default function ResolvePage() {
  const { slug: urlSlug } = useParams();
  const { profiles, loading: profilesLoading } = useProfiles();
  const [selectedProfile, setSelectedProfile] = useState(null);
  const { profile: profileDetail, loading: profileLoading } = useProfile(selectedProfile?.profile_slug);

  const [fieldValues, setFieldValues] = useState({});
  const [threshold, setThreshold] = useState(0.65);
  const [createIfMissing, setCreateIfMissing] = useState(false);
  const [results, setResults] = useState([]);
  const [similarEntities, setSimilarEntities] = useState([]);
  const [resolving, setResolving] = useState(false);
  const [findingSimilar, setFindingSimilar] = useState(false);
  const [error, setError] = useState(null);

  // Auto-select profile from URL
  useEffect(() => {
    if (urlSlug && profiles.length > 0 && !selectedProfile) {
      const found = profiles.find((p) => p.profile_slug === urlSlug);
      if (found) setSelectedProfile(found);
    }
  }, [urlSlug, profiles, selectedProfile]);

  // Reset form when profile changes
  useEffect(() => {
    if (profileDetail) {
      setFieldValues({});
      setThreshold(profileDetail.default_threshold);
      setResults([]);
      setSimilarEntities([]);
      setError(null);
    }
  }, [profileDetail?.profile_slug]);

  const handleResolve = async () => {
    if (!profileDetail) return;

    // Build fields payload — only include non-empty values
    const fields = {};
    Object.entries(fieldValues).forEach(([k, v]) => {
      if (v && v.trim()) fields[k] = v.trim();
    });

    if (Object.keys(fields).length === 0) {
      setError('Please fill in at least one field');
      return;
    }

    setResolving(true);
    setError(null);
    setResults([]);
    setSimilarEntities([]);

    try {
      const result = await resolveEntity(
        profileDetail.profile_slug,
        fields,
        threshold,
        createIfMissing
      );
      // Wrap single result in array
      setResults(result.entity_id ? [result] : []);
      if (!result.entity_id && !createIfMissing) {
        setError('No matches found above the threshold. Try lowering the threshold or enabling "Create if missing".');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setResolving(false);
    }
  };

  const handleFindSimilar = async () => {
    if (!profileDetail) return;

    // Build fields payload — only include non-empty values
    const fields = {};
    Object.entries(fieldValues).forEach(([k, v]) => {
      if (v && v.trim()) fields[k] = v.trim();
    });

    if (Object.keys(fields).length === 0) {
      setError('Please fill in at least one field');
      return;
    }

    setFindingSimilar(true);
    setError(null);
    setSimilarEntities([]);
    setResults([]);

    try {
      const results = await findSimilarEntities(
        profileDetail.profile_slug,
        fields,
        threshold,
        50
      );
      setSimilarEntities(results || []);
      if (!results || results.length === 0) {
        setError('No similar entities found above the threshold. Try lowering the threshold.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setFindingSimilar(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Entity Resolution</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Select a profile, fill in the entity fields, and resolve against existing entities.
      </Typography>

      {/* Profile Selector */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <ProfileSelector
            profiles={profiles}
            value={selectedProfile}
            onChange={(p) => setSelectedProfile(p)}
            loading={profilesLoading}
          />

          {profileDetail && (
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Chip label={`Entity Type: ${profileDetail.entity_type}`} size="small" variant="outlined" />
              <Chip label={`Fields: ${profileDetail.fields?.length || 0}`} size="small" variant="outlined" />
              <Chip label={`Entities: ${profileDetail.entity_count ?? 0}`} size="small" variant="outlined" />
              <Chip label={`Threshold: ${profileDetail.default_threshold}`} size="small" variant="outlined" color="primary" />
            </Stack>
          )}
        </CardContent>
      </Card>

      {profileLoading && <LoadingOverlay message="Loading profile..." />}

      {/* Input Form */}
      {profileDetail && !profileLoading && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>Input Fields</Typography>
            <DynamicFieldForm
              fields={profileDetail.fields}
              values={fieldValues}
              onChange={setFieldValues}
            />

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <ThresholdSlider value={threshold} onChange={setThreshold} />
              </Box>
              <FormControlLabel
                control={
                  <Checkbox checked={createIfMissing} onChange={(e) => setCreateIfMissing(e.target.checked)} />
                }
                label="Create if no match found"
              />
            </Box>

            <Box sx={{ mt: 2, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <Button
                variant="outlined"
                size="large"
                startIcon={<FindInPageIcon />}
                onClick={handleFindSimilar}
                disabled={findingSimilar || resolving}
              >
                {findingSimilar ? 'Searching...' : 'Find Similar'}
              </Button>
              <Button
                variant="contained"
                size="large"
                startIcon={<SearchIcon />}
                onClick={handleResolve}
                disabled={resolving || findingSimilar}
              >
                {resolving ? 'Resolving...' : 'Resolve'}
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Resolve Results */}
      {results.length > 0 && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">Best Match</Typography>
              <Stack direction="row" spacing={1}>
                {results[0]?.execution_ms != null && (
                  <Chip label={`${results[0].execution_ms}ms`} size="small" variant="outlined" />
                )}
                {results[0]?.was_cached && (
                  <Chip label="Cached" size="small" color="info" variant="outlined" />
                )}
              </Stack>
            </Box>
            <ResultsTable results={results} profileFields={profileDetail?.fields} />
          </CardContent>
        </Card>
      )}

      {/* Find Similar Results */}
      {similarEntities.length > 0 && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Similar Entities ({similarEntities.length})
              </Typography>
              <Chip 
                label={`Threshold: ${threshold}`} 
                size="small" 
                variant="outlined" 
                color="primary"
              />
            </Box>
            <Alert severity="info" sx={{ mb: 2 }}>
              Showing all entities matching above the threshold, sorted by match score. 
              Expand rows to see field-level score breakdowns.
            </Alert>
            <ResultsTable results={similarEntities} profileFields={profileDetail?.fields} />
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
