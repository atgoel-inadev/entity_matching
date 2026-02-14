import client from './client';

export const resolveEntity = (slug, fields, threshold, createIfMissing = false) =>
  client.post(`/profiles/${slug}/resolve`, {
    fields,
    threshold,
    create_if_missing: createIfMissing,
  }).then((r) => r.data);

export const findSimilarEntities = (slug, fields, threshold, limit = 10) =>
  client.post(`/profiles/${slug}/find-similar`, {
    fields,
    threshold,
  }, {
    params: { limit },
  }).then((r) => r.data);

export const resolveBatch = (slug, entities) =>
  client.post(`/profiles/${slug}/resolve/batch`, { entities }).then((r) => r.data);
