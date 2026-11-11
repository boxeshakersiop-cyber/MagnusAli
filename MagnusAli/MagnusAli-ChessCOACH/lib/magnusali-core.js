(function () {
  if (window.MagnusAliCore) return;

  const BRAND = Object.freeze({
    name: "MagnusAli ChessCOACH",
    shortName: "MagnusAli",
    version: "16.1.0",
    minElo: 400,
    maxElo: 4000,
    accent: "#7dd3a7",
    accentGold: "#e7c778"
  });

  const RATING_SELECTORS = Object.freeze({
    lichess: [
      ".ruser-top .rating",
      ".round__app__user:first-of-type .rating",
      ".round__app__user:first-of-type rating",
      ".game__meta__infos .rating"
    ],
    chesscom: [
      ".board-layout-top .user-tagline-rating",
      ".board-layout-top [data-test-element='user-tagline-rating']",
      ".player-top .user-tagline-rating",
      "[data-test-element='opponent-rating']",
      "[data-cy='opponent-rating']"
    ]
  });

  function clampElo(value, fallback = 2600) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(BRAND.minElo, Math.min(BRAND.maxElo, Math.round(numeric / 100) * 100));
  }

  function parseRatingText(value) {
    const text = String(value || "")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/,/g, ".")
      .trim()
      .toLowerCase();
    if (!text) return null;

    const compact = text.replace(/\s+/g, "");
    const kiloMatch = compact.match(/(?:^|[^\d])(\d(?:\.\d{1,2})?)k(?:$|[^a-z])/i);
    if (kiloMatch) {
      const rating = Math.round(parseFloat(kiloMatch[1]) * 1000);
      return rating >= 100 && rating <= 5000 ? rating : null;
    }

    const matches = compact.match(/\d{3,4}/g) || [];
    for (const match of matches) {
      const rating = parseInt(match, 10);
      if (rating >= 100 && rating <= 5000) return rating;
    }
    return null;
  }

  function isVisible(node) {
    if (!node || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function detectOpponentRating(platform) {
    const key = platform === "chess.com" || platform === "chesscom" ? "chesscom" : "lichess";
    const selectors = RATING_SELECTORS[key];
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const rating = parseRatingText(node.textContent || node.getAttribute("aria-label"));
        if (rating) return rating;
      }
    }

    const topHalfCandidates = document.querySelectorAll(
      key === "chesscom"
        ? ".board-layout-player-top [class*='rating'], .player-top [class*='rating']"
        : ".ruser-top [class*='rating'], .round__app__user [class*='rating']"
    );
    for (const node of topHalfCandidates) {
      if (!isVisible(node)) continue;
      const rating = parseRatingText(node.textContent || node.getAttribute("aria-label"));
      if (rating) return rating;
    }
    return null;
  }

  function classifyOpponent(rating) {
    if (!Number.isFinite(rating)) {
      return { key: "unknown", label: "Соперник: рейтинг не найден", color: "#94a3b8", scholarEligible: false };
    }
    if (rating <= 1200) {
      return { key: "beginner", label: `Соперник ${rating} • быстрый мат`, color: "#e7c778", scholarEligible: true };
    }
    if (rating <= 1800) {
      return { key: "club", label: `Соперник ${rating} • клубный`, color: "#7dd3a7", scholarEligible: false };
    }
    if (rating <= 2400) {
      return { key: "expert", label: `Соперник ${rating} • эксперт`, color: "#67b7dc", scholarEligible: false };
    }
    if (rating < 3000) {
      return { key: "master", label: `Соперник ${rating} • мастер`, color: "#b9a3e3", scholarEligible: false };
    }
    return { key: "supergm", label: `Соперник ${rating} • SUPER-GM`, color: "#ff8fa3", scholarEligible: false };
  }

  function getEffectiveElo(configuredElo, opponentRating, adaptive = true) {
    const selected = clampElo(configuredElo);
    if (!adaptive || !Number.isFinite(opponentRating)) return selected;
    if (opponentRating >= 3000) return Math.max(selected, 4000);
    if (opponentRating >= 2700) return Math.max(selected, 3600);
    return selected;
  }

  function getStockfishBudget({ elo, danger = false, turbo = false, mySeconds = 999 }) {
    const level = clampElo(elo);
    if (turbo || mySeconds <= 5) return { movetimeMs: 105, multiPv: 1, label: "TURBO" };

    let movetimeMs = 180;
    if (level >= 4000) movetimeMs = 3200;
    else if (level >= 3800) movetimeMs = 2200;
    else if (level >= 3600) movetimeMs = 1500;
    else if (level >= 3400) movetimeMs = 1050;
    else if (level >= 3200) movetimeMs = 760;
    else if (level >= 3000) movetimeMs = 560;
    else if (level >= 2600) movetimeMs = 390;
    else if (level >= 2200) movetimeMs = 280;

    if (danger) movetimeMs = Math.round(movetimeMs * 1.42);
    if (mySeconds <= 15) movetimeMs = Math.min(movetimeMs, 240);
    else if (mySeconds <= 35) movetimeMs = Math.min(movetimeMs, 520);

    return {
      movetimeMs,
      multiPv: level >= 3800 ? 1 : 3,
      label: level >= 3900 ? "MAGNUS HUNTER" : (level >= 3400 ? "SUPER-GM" : "ADAPTIVE")
    };
  }

  function pieceAt(grid, square) {
    if (!grid || !square || square.length !== 2) return null;
    const file = "abcdefgh".indexOf(square[0]);
    const rank = 8 - parseInt(square[1], 10);
    return grid[rank]?.[file] || null;
  }

  function getScholarCandidate({ grid, myColor, history, opponentRating }) {
    const profile = classifyOpponent(opponentRating);
    const moves = Array.isArray(history) ? history : [];
    if (!profile.scholarEligible || myColor !== "w" || moves.length > 8 || !grid) return null;
    if (pieceAt(grid, "e8") !== "k" || pieceAt(grid, "f7") !== "p") return null;

    if (pieceAt(grid, "h5") === "Q" && pieceAt(grid, "g6") === null) {
      return { uci: "h5f7", stage: "finish", label: "👑 Детский мат: Qxf7#" };
    }

    if (pieceAt(grid, "d1") === "Q" && pieceAt(grid, "e2") === null && pieceAt(grid, "f3") === null && pieceAt(grid, "g4") === null) {
      const bishopDeveloped = pieceAt(grid, "c4") === "B" || pieceAt(grid, "b5") === "B";
      if (bishopDeveloped && moves.includes("e2e4")) {
        return { uci: "d1h5", stage: "queen", label: "🎯 Детский мат: Qh5" };
      }
    }

    if (pieceAt(grid, "f1") === "B" && pieceAt(grid, "e2") === null && moves.includes("e2e4")) {
      return { uci: "f1c4", stage: "bishop", label: "🎯 Детский мат: Bc4" };
    }

    if (pieceAt(grid, "e2") === "P" && moves.length === 0) {
      return { uci: "e2e4", stage: "center", label: "🎯 Детский мат: e4" };
    }
    return null;
  }

  function chooseScholarLine({ lines, grid, myColor, history, opponentRating }) {
    const candidate = getScholarCandidate({ grid, myColor, history, opponentRating });
    if (!candidate || !lines) return null;

    const ordered = Object.keys(lines)
      .map((key) => lines[key])
      .filter((line) => line && line.uci)
      .sort((a, b) => (a.multiPv || 1) - (b.multiPv || 1));
    if (ordered.length === 0) return null;

    const best = ordered[0];
    const chosen = ordered.find((line) => line.uci === candidate.uci);
    if (!chosen) return null;

    const forcedMate = Boolean(chosen.isMate && chosen.mateIn > 0);
    const cpLoss = (Number(best.scoreCp) || 0) - (Number(chosen.scoreCp) || 0);
    const maxSafeLoss = candidate.stage === "finish" ? 0 : 70;
    if (!forcedMate && (chosen.isMate || cpLoss > maxSafeLoss || chosen.scoreCp < -80)) return null;

    return { ...chosen, scholarPlan: true, scholarLabel: candidate.label, scholarStage: candidate.stage };
  }

  window.MagnusAliCore = Object.freeze({
    BRAND,
    clampElo,
    parseRatingText,
    detectOpponentRating,
    classifyOpponent,
    getEffectiveElo,
    getStockfishBudget,
    getScholarCandidate,
    chooseScholarLine
  });
})();
