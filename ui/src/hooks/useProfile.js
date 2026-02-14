import { useState, useEffect, useCallback } from 'react';
import { getProfile } from '../api/profiles';

export default function useProfile(slug) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(!!slug);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getProfile(slug);
      setProfile(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { fetch(); }, [fetch]);

  return { profile, loading, error, refetch: fetch };
}
