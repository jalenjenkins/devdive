"use strict";

const crypto = require("node:crypto");
const { match } = require("./matcher");
const { TIERS, LAYERS, tierInfo, layerFor, emojiRow } = require("./scoring");
const { dateKey, addDays, puzzleNumber } = require("./daily");
const { choosePrompts } = require("./catalog");

class GameError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

class Game {
  constructor({ database, catalog, config, now = () => Date.now() }) {
    this.db = database;
    this.catalog = catalog;
    this.config = config;
    this.now = now;
    this.puzzleCache = new Map();
  }

  today() {
    return dateKey(new Date(this.now()), this.config.timezone);
  }

  meta() {
    const date = this.today();
    return {
      date,
      puzzleNumber: puzzleNumber(date, this.config.launchDate),
      questionsPerDay: this.config.questionsPerDay,
      questionSeconds: this.config.questionSeconds,
      tiers: TIERS,
      layers: LAYERS,
      catalogVersion: this.catalog.version,
      content: {
        prompts: this.catalog.prompts.length,
        categories: new Set(this.catalog.prompts.map((p) => p.category)).size,
        sources: this.catalog.sources,
      },
      identity: "anonymous-browser-session",
      rarityPolicy: this.catalog.rarityPolicy,
    };
  }

  async puzzle(tx, date) {
    if (this.puzzleCache.has(date)) return this.puzzleCache.get(date);
    let row = (
      await tx.query("SELECT prompts FROM daily_puzzles WHERE puzzle_date=$1", [
        date,
      ])
    ).rows[0];
    const alreadyPublished = Boolean(row);
    if (!row) {
      const recent = (
        await tx.query(
          "SELECT prompts FROM daily_puzzles WHERE puzzle_date >= $1 AND puzzle_date < $2",
          [addDays(date, -14), date],
        )
      ).rows.flatMap((r) => JSON.parse(r.prompts).map((p) => p.id));
      const prompts = choosePrompts(
        this.catalog,
        date,
        this.config.questionsPerDay,
        recent,
      );
      await tx.query(
        "INSERT INTO daily_puzzles(puzzle_date,catalog_version,prompts,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(puzzle_date) DO NOTHING",
        [date, this.catalog.version, JSON.stringify(prompts), this.now()],
      );
      row = (
        await tx.query(
          "SELECT prompts FROM daily_puzzles WHERE puzzle_date=$1",
          [date],
        )
      ).rows[0];
    }
    const prompts = JSON.parse(row.prompts);
    // Never cache an uncommitted insert: a later rollback must not leave a
    // process believing a database snapshot exists when it does not.
    if (alreadyPublished) this.puzzleCache.set(date, prompts);
    if (this.puzzleCache.size > 32)
      this.puzzleCache.delete(this.puzzleCache.keys().next().value);
    return prompts;
  }

  async start(playerId, name = "") {
    if (!/^[a-f0-9]{64}$/.test(playerId))
      throw new GameError(400, "invalid session");
    if (typeof name !== "string")
      throw new GameError(400, "display name must be text");
    name = name
      .replace(/[^\w .-]/g, "")
      .trim()
      .slice(0, 16);
    return this.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO players(id,created_at,last_seen) VALUES($1,$2,$2) ON CONFLICT(id) DO NOTHING",
        [playerId, this.now()],
      );
      // Serializes concurrent starts by the same player, including on other instances.
      await tx.query("SELECT id FROM players WHERE id=$1 FOR UPDATE", [
        playerId,
      ]);
      await tx.query("UPDATE players SET last_seen=$1 WHERE id=$2", [
        this.now(),
        playerId,
      ]);
      const date = this.today();
      const prompts = await this.puzzle(tx, date);
      let row = (
        await tx.query(
          "SELECT * FROM rounds WHERE player_id=$1 AND puzzle_date=$2 FOR UPDATE",
          [playerId, date],
        )
      ).rows[0];
      if (!row) {
        const state = {
          name,
          index: 0,
          score: 0,
          depth: 0,
          answers: [],
          qStart: this.now(),
          totalMs: this.config.questionSeconds * 1000,
          graceMs: this.config.graceMs,
        };
        row = {
          id: crypto.randomBytes(32).toString("hex"),
          player_id: playerId,
          puzzle_date: date,
          state: JSON.stringify(state),
        };
        await tx.query(
          "INSERT INTO rounds(id,player_id,puzzle_date,state,updated_at) VALUES($1,$2,$3,$4,$5)",
          [row.id, playerId, date, row.state, this.now()],
        );
      }
      const round = this.decode(row, prompts);
      if (round.index >= prompts.length)
        return { finished: true, summary: await this.summary(tx, round.id) };
      if (round.qStart === null) {
        const last = (
          await tx.query(
            "SELECT response FROM submissions WHERE round_id=$1 AND question_index=$2",
            [round.id, round.index - 1],
          )
        ).rows[0];
        return {
          finished: false,
          roundToken: round.id,
          reveal: JSON.parse(last.response),
        };
      }
      if (this.expired(round)) {
        const reveal = await this.recordAnswer(tx, round, "");
        return { finished: false, roundToken: round.id, reveal };
      }
      return { finished: false, ...this.view(round) };
    });
  }

  decode(row, prompts) {
    return {
      ...JSON.parse(row.state),
      id: row.id,
      playerId: row.player_id,
      date: row.puzzle_date,
      prompts,
    };
  }

  async round(tx, token, playerId) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      throw new GameError(404, "round not found");
    const row = (
      await tx.query(
        "SELECT * FROM rounds WHERE id=$1 AND player_id=$2 FOR UPDATE",
        [token, playerId],
      )
    ).rows[0];
    if (!row) throw new GameError(404, "round not found");
    return this.decode(row, await this.puzzle(tx, row.puzzle_date));
  }

  async save(tx, round) {
    const { id, playerId, date, prompts, ...state } = round;
    await tx.query(
      "UPDATE rounds SET state=$1,updated_at=$2,completed_at=$3 WHERE id=$4",
      [
        JSON.stringify(state),
        this.now(),
        round.index >= prompts.length ? this.now() : null,
        id,
      ],
    );
  }

  next(token, index, playerId) {
    if (!Number.isInteger(index))
      throw new GameError(400, "index must be an integer");
    return this.db.transaction(async (tx) => {
      const round = await this.round(tx, token, playerId);
      if (index !== round.index || round.index >= round.prompts.length)
        throw new GameError(409, "question is no longer current");
      if (round.qStart === null) {
        round.qStart = this.now();
        await this.save(tx, round);
      }
      return this.view(round);
    });
  }

  answer(token, index, input, playerId) {
    if (
      !Number.isInteger(index) ||
      typeof input !== "string" ||
      input.length > 80
    )
      throw new GameError(
        400,
        "answer must be at most 80 characters and index must be an integer",
      );
    return this.db.transaction(async (tx) => {
      const round = await this.round(tx, token, playerId);
      const previous = (
        await tx.query(
          "SELECT request_hash,response FROM submissions WHERE round_id=$1 AND question_index=$2",
          [token, index],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== this.inputHash(input))
          throw new GameError(
            409,
            "this question already has an answer; reload to resume",
          );
        return JSON.parse(previous.response);
      }
      if (round.index >= round.prompts.length || index !== round.index)
        throw new GameError(409, "question is no longer current");
      if (round.qStart === null)
        throw new GameError(409, "start the next question first", {
          needsNext: true,
        });
      return this.recordAnswer(tx, round, input);
    });
  }

  inputHash(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
  }
  expired(round) {
    return (
      round.qStart !== null &&
      this.now() > round.qStart + round.totalMs + round.graceMs
    );
  }

  async recordAnswer(tx, round, input) {
    const index = round.index,
      prompt = round.prompts[index];
    const timedOut =
      this.expired(round) ||
      (!input.trim() && this.now() >= round.qStart + round.totalMs);
    const hit = timedOut ? null : match(input, prompt.answers);
    const info = hit ? tierInfo(hit.answer.tier) : null;
    const result = {
      matched: Boolean(hit),
      timedOut,
      canonical: hit?.answer.canonical || null,
      tier: info?.tier || 0,
      tierName: info?.name || null,
      emoji: info?.emoji || null,
      points: info?.points || 0,
      depthGained: info?.depth || 0,
      fact: prompt.fact || "",
      rarest: [...prompt.answers]
        .filter((a) => a.canonical !== hit?.answer.canonical)
        .sort(
          (a, b) =>
            b.tier - a.tier || a.canonical.localeCompare(b.canonical, "en"),
        )
        .slice(0, 3)
        .map((a) => a.canonical),
      source: prompt.sourceDetails,
    };
    round.answers.push({
      promptId: prompt.id,
      tier: result.tier,
      input,
      canonical: result.canonical,
      timedOut,
    });
    round.score += result.points;
    round.depth += result.depthGained;
    round.index++;
    round.qStart = null;
    const response = {
      question: {
        index,
        total: round.prompts.length,
        prompt: { id: prompt.id, text: prompt.text, category: prompt.category },
      },
      result,
      score: round.score,
      depth: round.depth,
      layer: layerFor(round.depth),
      next:
        round.index < round.prompts.length
          ? { index: round.index, total: round.prompts.length }
          : null,
    };
    await this.save(tx, round);
    if (!response.next) {
      await tx.query(
        "INSERT INTO results(round_id,player_id,puzzle_date,name,score,depth,tiers,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(player_id,puzzle_date) DO NOTHING",
        [
          round.id,
          round.playerId,
          round.date,
          round.name,
          round.score,
          round.depth,
          JSON.stringify(round.answers.map((a) => a.tier)),
          this.now(),
        ],
      );
      response.summary = await this.summary(tx, round.id);
    }
    await tx.query(
      "INSERT INTO submissions(round_id,question_index,request_hash,response,created_at) VALUES($1,$2,$3,$4,$5)",
      [
        round.id,
        index,
        this.inputHash(input),
        JSON.stringify(response),
        this.now(),
      ],
    );
    return response;
  }

  view(round) {
    const prompt = round.prompts[round.index];
    return {
      roundToken: round.id,
      total: round.prompts.length,
      index: round.index,
      prompt: { id: prompt.id, text: prompt.text, category: prompt.category },
      msLeft: Math.max(0, round.qStart + round.totalMs - this.now()),
      totalMs: round.totalMs,
      score: round.score,
      depth: round.depth,
      layer: layerFor(round.depth),
      tiers: round.answers.map((a) => a.tier),
    };
  }

  async leaderboard(date = this.today(), limit = 20, tx = this.db) {
    const rows = (
      await tx.query(
        "SELECT name,score,depth FROM results WHERE puzzle_date=$1 ORDER BY score DESC,depth DESC,completed_at,round_id LIMIT $2",
        [date, Math.min(100, limit)],
      )
    ).rows;
    return {
      date,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        name: r.name || "anon",
        score: r.score,
        depth: r.depth,
      })),
    };
  }

  async summary(tx, roundId) {
    const r = (
      await tx.query("SELECT * FROM results WHERE round_id=$1", [roundId])
    ).rows[0];
    if (!r) throw new GameError(404, "result not found");
    const stats = (
      await tx.query(
        `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN score > $2 OR (score=$2 AND depth > $3) OR (score=$2 AND depth=$3 AND completed_at < $4) OR (score=$2 AND depth=$3 AND completed_at=$4 AND round_id < $5) THEN 1 ELSE 0 END),0) AS better
      FROM results WHERE puzzle_date=$1`,
        [r.puzzle_date, r.score, r.depth, Number(r.completed_at), r.round_id],
      )
    ).rows[0];
    const tiers = JSON.parse(r.tiers),
      layer = layerFor(r.depth),
      number = puzzleNumber(r.puzzle_date, this.config.launchDate),
      row = emojiRow(tiers);
    return {
      date: r.puzzle_date,
      puzzleNumber: number,
      score: r.score,
      depth: r.depth,
      layer,
      tiers,
      emojiRow: row,
      share:
        "Downstack #" +
        number +
        " " +
        row +
        " " +
        r.depth +
        "m (" +
        layer.name +
        ") " +
        r.score +
        " pts",
      rank: Number(stats.better) + 1,
      totalPlayers: Number(stats.total),
      leaderboard: (await this.leaderboard(r.puzzle_date, 10, tx)).entries,
    };
  }

  report(token, index, note, playerId) {
    if (
      !Number.isInteger(index) ||
      typeof note !== "string" ||
      note.length > 500
    )
      throw new GameError(400, "invalid report");
    return this.db.transaction(async (tx) => {
      const round = await this.round(tx, token, playerId);
      const answer = round.answers[index];
      if (!answer || answer.timedOut || !answer.input.trim())
        throw new GameError(400, "only submitted answers can be reported");
      await tx.query(
        "INSERT INTO answer_reports(id,round_id,player_id,question_index,input,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(round_id,question_index) DO NOTHING",
        [
          crypto.randomUUID(),
          token,
          playerId,
          index,
          answer.input,
          note,
          this.now(),
        ],
      );
      return { ok: true };
    });
  }
}

module.exports = { Game, GameError };
