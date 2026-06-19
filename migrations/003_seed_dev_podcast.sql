INSERT INTO podcasts (
  podcast_id,
  title,
  description
)
VALUES (
  1,
  'Podcaster''s DevLog',
  'Development environment podcast managed by podcast-ui.'
)
ON CONFLICT (podcast_id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('podcasts', 'podcast_id'),
  GREATEST((SELECT MAX(podcast_id) FROM podcasts), 1)
);
