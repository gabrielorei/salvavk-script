-- Índice global para o espelho de notificações e o cursor incremental.
-- Execute uma única vez no D1 salva-vk-db, em SQL Console.

CREATE INDEX IF NOT EXISTS idx_reactions_updated_global
ON reactions (updated_at, topic, comment_id, user_id);
