import client from './client';

export const listEntities = (slug, limit = 50, offset = 0) =>
  client.get(`/profiles/${slug}/entities`, { params: { limit, offset } }).then((r) => r.data);

export const getEntity = (slug, entityId) =>
  client.get(`/profiles/${slug}/entities/${entityId}`).then((r) => r.data);

export const updateEntity = (slug, entityId, data) =>
  client.put(`/profiles/${slug}/entities/${entityId}`, data).then((r) => r.data);

export const bulkLoadEntities = (slug, entities) =>
  client.post(`/profiles/${slug}/entities`, { entities }).then((r) => r.data);

export const deleteEntity = (slug, entityId) =>
  client.delete(`/profiles/${slug}/entities/${entityId}`).then((r) => r.data);

