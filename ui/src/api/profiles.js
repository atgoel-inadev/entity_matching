import client from './client';

export const listProfiles = (activeOnly = true) =>
  client.get('/profiles', { params: { active_only: activeOnly } }).then((r) => r.data);

export const getProfile = (slug) =>
  client.get(`/profiles/${slug}`).then((r) => r.data);

export const createProfile = (data) =>
  client.post('/profiles', data).then((r) => r.data);

export const updateProfile = (slug, data) =>
  client.put(`/profiles/${slug}`, data).then((r) => r.data);

export const deleteProfile = (slug) =>
  client.delete(`/profiles/${slug}`).then((r) => r.data);

export const addField = (slug, field) =>
  client.post(`/profiles/${slug}/fields`, field).then((r) => r.data);

export const updateField = (slug, fieldName, data) =>
  client.put(`/profiles/${slug}/fields/${fieldName}`, data).then((r) => r.data);

export const deleteField = (slug, fieldName) =>
  client.delete(`/profiles/${slug}/fields/${fieldName}`).then((r) => r.data);
