import client from './client';

export const healthCheck = () =>
  client.get('/health').then((r) => r.data);

export const getStats = () =>
  client.get('/stats').then((r) => r.data);

export const getProfileStats = (slug) =>
  client.get(`/profiles/${slug}/stats`).then((r) => r.data);
