-- #174 の途中で足した列（011）を消す。収録ルームは承認済みのユーザーが使える形にしたため不要になった。
-- 011 は dev にだけ当たっている（prod には無いので何もしない）。
ALTER TABLE users DROP COLUMN IF EXISTS recording_allowed;
