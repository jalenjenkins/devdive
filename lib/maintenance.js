"use strict";
const { dateKey } = require("./daily");

async function maintenance(db, config, now = Date.now()) {
  const cutoff = now - config.retentionDays * 86400000;
  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM rate_limits WHERE window_start < $1", [
      now - 3600000,
    ]);
    await tx.query("DELETE FROM rounds WHERE updated_at < $1", [cutoff]);
    await tx.query(
      "DELETE FROM daily_puzzles WHERE puzzle_date < $1 AND NOT EXISTS (SELECT 1 FROM rounds WHERE rounds.puzzle_date=daily_puzzles.puzzle_date)",
      [dateKey(new Date(cutoff), config.timezone)],
    );
    await tx.query(
      "DELETE FROM players WHERE last_seen < $1 AND NOT EXISTS (SELECT 1 FROM rounds WHERE rounds.player_id=players.id)",
      [cutoff],
    );
  });
}

module.exports = { maintenance };
