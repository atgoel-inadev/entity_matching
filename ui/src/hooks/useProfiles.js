import { useState, useEffect, useCallback } from 'react';
import { listProfiles } from '../api/profiles';

export default function useProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProfiles(false);
      setProfiles(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { profiles, loading, error, refetch: fetch };
}
