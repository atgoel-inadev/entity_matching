import { useState, useEffect, useCallback } from 'react';
import { listEntities } from '../api/entities';

export default function useEntities(slug, limit = 50) {
  const [entities, setEntities] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(!!slug);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);

  const fetch = useCallback(async (newOffset) => {
    if (!slug) return;
    const o = newOffset !== undefined ? newOffset : offset;
    setLoading(true);
    setError(null);
    try {
      const data = await listEntities(slug, limit, o);
      // API returns paginated response: { entities: [...], total, limit, offset }
      setEntities(data.entities || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [slug, limit, offset]);

  useEffect(() => { fetch(); }, [fetch]);

  const goToPage = (page) => {
    const newOffset = page * limit;
    setOffset(newOffset);
    fetch(newOffset);
  };

  return { entities, total, loading, error, offset, goToPage, refetch: () => fetch(offset) };
}
