import { useState, useEffect, useRef, useMemo, useCallback } from "react";

const W = 720;
const H = 520;
const GROUND_Y = 460;

const THRUST = 0.032;
const SIDE_THRUST = 0.016;
const FUEL_RATE = 0.20;
const SIDE_FUEL_RATE = 0.10;
const SAFE_V = 0.8;
const HARD_V = 1.4;
const DRAG_X = 0.997;
const DRAG_Y = 0.998;
const MAX_TILT = 0.2;

const MAX_ROUNDS = 10;
const START_WEALTH = 10000;
const BASE_RISK_FREE_RATE = 0.016;
const MIN_RISK_FREE_RATE = 0.004;
const PAD_EDGE_BASE = [0.010, 0.006, 0.003];
const PAD_EDGE_FLOOR = [0.004, 0.002, 0.0008];
const MARKET_BOOK_KEY = "rocket_lander_market_book_v1";
const MARKET_PRIOR_STRENGTH = 30;
const ACTION_TAU_FRAC = 0.026;
const BANKRUPT_FLOOR = 100;
const WEALTH_FLOOR = 1;

const PADS = [
  {
    label: "Wide",
    width: 110,
    color: "#4ade80",
    risk: 0.0,
    fuelBonusCapPct: 0.03,
    desc: "High hit-rate, low variance",
  },
  {
    label: "Standard",
    width: 46,
    color: "#fbbf24",
    risk: 0.55,
    fuelBonusCapPct: 0.05,
    desc: "Balanced risk / reward",
  },
  {
    label: "Micro",
    width: 16,
    color: "#f87171",
    risk: 1.0,
    fuelBonusCapPct: 0.08,
    desc: "Tiny target, convex payoff",
  },
];

const DIFF_TIERS = [
  { gravity: 0.008, fuel: 110, wind: 0.0, label: "Calm Orbit" },
  { gravity: 0.010, fuel: 104, wind: 0.15, label: "Steady Descent" },
  { gravity: 0.012, fuel: 98, wind: 0.30, label: "Light Crosswind" },
  { gravity: 0.014, fuel: 92, wind: 0.50, label: "Breezy Conditions" },
  { gravity: 0.017, fuel: 85, wind: 0.70, label: "Gusty Approach" },
  { gravity: 0.019, fuel: 78, wind: 0.90, label: "Turbulent Descent" },
  { gravity: 0.022, fuel: 70, wind: 1.10, label: "Heavy Crosswind" },
  { gravity: 0.025, fuel: 62, wind: 1.30, label: "Storm Approach" },
  { gravity: 0.028, fuel: 55, wind: 1.60, label: "Severe Turbulence" },
  { gravity: 0.031, fuel: 48, wind: 1.80, label: "Hurricane Landing" },
];

const START_Y = [20, 20, 18, 18, 17, 17, 16, 16, 15, 14];

const GAMMA_GRID = Array.from({ length: 31 }, (_, i) => 0.4 + i * 0.2);
const EDGE_GRID = Array.from({ length: 25 }, (_, i) => -0.6 + i * 0.05);
const FRACTION_GRID = Array.from({ length: 51 }, (_, i) => i / 50);

const GAMMA_PROFILES = [
  { max: 0.8, title: "Convexity Hunter", desc: "You lean hard into positive skew and are happy wearing drawdown risk." },
  { max: 1.6, title: "Kelly-ish", desc: "You like edge and still tolerate chunky variance when the quote looks good." },
  { max: 2.8, title: "Balanced Allocator", desc: "You will size up when you think you have an edge, but you respect capital preservation." },
  { max: 4.2, title: "Capital Preserver", desc: "You protect wealth first and only scale risk when the upside is very persuasive." },
  { max: Infinity, title: "Treasury Brain", desc: "You would rather compound safely than expose much of the portfolio to one mission." },
];

const EDGE_PROFILES = [
  { max: -0.25, title: "Underconfident", desc: "You behave as if your true hit-rate is worse than your demonstrated skill." },
  { max: -0.08, title: "Slightly conservative", desc: "You shade your own edge down a bit and demand more proof before sizing up." },
  { max: 0.10, title: "Calibrated", desc: "Your betting looks roughly in line with the skill the game has observed." },
  { max: 0.28, title: "Confident", desc: "You behave as if you have a real edge and will pay up for high-upside missions." },
  { max: Infinity, title: "Very confident", desc: "You routinely act as if your personal hit-rate is materially better than the market quote." },
];

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function logit(p) {
  const q = clamp(p, 1e-6, 1 - 1e-6);
  return Math.log(q / (1 - q));
}

function fmt$(n) {
  const v = Math.round(n);
  return "$" + v.toLocaleString("en-US");
}

function fmtSigned$(n) {
  const v = Math.round(n);
  if (v > 0) return "+$" + v.toLocaleString("en-US");
  if (v < 0) return "-$" + Math.abs(v).toLocaleString("en-US");
  return "$0";
}

function fmtPct(x, digits = 0) {
  return `${(x * 100).toFixed(digits)}%`;
}

function crraUtil(x, gamma) {
  const w = Math.max(WEALTH_FLOOR, x);
  if (Math.abs(gamma - 1) < 0.04) return Math.log(w);
  return Math.pow(w, 1 - gamma) / (1 - gamma);
}

function invCrraUtil(u, gamma) {
  if (Math.abs(gamma - 1) < 0.04) return Math.exp(u);
  const a = (1 - gamma) * u;
  if (!(a > 0) || !isFinite(a)) return WEALTH_FLOOR;
  return Math.pow(a, 1 / (1 - gamma));
}

function createJointPrior() {
  const prior = [];
  const gammaMu = 2.6;
  const gammaSigma = 1.6;
  const edgeMu = 0.0;
  const edgeSigma = 0.35;

  for (let gi = 0; gi < GAMMA_GRID.length; gi++) {
    for (let ei = 0; ei < EDGE_GRID.length; ei++) {
      const g = GAMMA_GRID[gi];
      const e = EDGE_GRID[ei];
      const lp =
        -0.5 * Math.pow((g - gammaMu) / gammaSigma, 2) +
        -0.5 * Math.pow((e - edgeMu) / edgeSigma, 2);
      prior.push(Math.exp(lp));
    }
  }

  const sum = prior.reduce((a, b) => a + b, 0);
  return prior.map((p) => p / sum);
}

function flattenIndex(gi, ei) {
  return gi * EDGE_GRID.length + ei;
}

function credibleInterval(grid, marginal) {
  let c = 0;
  let lo = grid[0];
  let hi = grid[grid.length - 1];
  let loFound = false;
  for (let i = 0; i < grid.length; i++) {
    c += marginal[i];
    if (!loFound && c >= 0.025) {
      lo = grid[i];
      loFound = true;
    }
    if (c >= 0.975) {
      hi = grid[i];
      break;
    }
  }
  return { lo, hi };
}

function jointPosteriorStats(posterior) {
  const gammaMarginal = new Array(GAMMA_GRID.length).fill(0);
  const edgeMarginal = new Array(EDGE_GRID.length).fill(0);

  for (let gi = 0; gi < GAMMA_GRID.length; gi++) {
    for (let ei = 0; ei < EDGE_GRID.length; ei++) {
      const p = posterior[flattenIndex(gi, ei)];
      gammaMarginal[gi] += p;
      edgeMarginal[ei] += p;
    }
  }

  let gammaMean = 0;
  let edgeMean = 0;
  for (let gi = 0; gi < GAMMA_GRID.length; gi++) gammaMean += GAMMA_GRID[gi] * gammaMarginal[gi];
  for (let ei = 0; ei < EDGE_GRID.length; ei++) edgeMean += EDGE_GRID[ei] * edgeMarginal[ei];

  let gammaVar = 0;
  let edgeVar = 0;
  for (let gi = 0; gi < GAMMA_GRID.length; gi++) gammaVar += Math.pow(GAMMA_GRID[gi] - gammaMean, 2) * gammaMarginal[gi];
  for (let ei = 0; ei < EDGE_GRID.length; ei++) edgeVar += Math.pow(EDGE_GRID[ei] - edgeMean, 2) * edgeMarginal[ei];

  const gammaCI = credibleInterval(GAMMA_GRID, gammaMarginal);
  const edgeCI = credibleInterval(EDGE_GRID, edgeMarginal);

  return {
    gammaMean,
    gammaSigma: Math.sqrt(gammaVar),
    edgeMean,
    edgeSigma: Math.sqrt(edgeVar),
    gammaMarginal,
    edgeMarginal,
    gammaLo95: gammaCI.lo,
    gammaHi95: gammaCI.hi,
    edgeLo95: edgeCI.lo,
    edgeHi95: edgeCI.hi,
  };
}

function jointUpdate(prior, logLike, weight = 1) {
  const w = clamp(weight, 0.05, 3);
  const maxLL = Math.max(...logLike);
  const posterior = prior.map((p, i) => p * Math.exp((logLike[i] - maxLL) * w));
  const sum = posterior.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !isFinite(sum)) return prior;
  return posterior.map((p) => p / sum);
}

function jointUpdateGammaOnly(prior, gammaLogLike, weight = 1) {
  const w = clamp(weight, 0.05, 2);
  const maxLL = Math.max(...gammaLogLike);
  const posterior = new Array(prior.length);
  for (let gi = 0; gi < GAMMA_GRID.length; gi++) {
    const mult = Math.exp((gammaLogLike[gi] - maxLL) * w);
    for (let ei = 0; ei < EDGE_GRID.length; ei++) {
      const idx = flattenIndex(gi, ei);
      posterior[idx] = prior[idx] * mult;
    }
  }
  const sum = posterior.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !isFinite(sum)) return prior;
  return posterior.map((p) => p / sum);
}

function createSkillState() {
  return { mu: 0.5, sigma2: 0.14 };
}

function updateSkill(prior, impliedSkill, noiseVar = 0.12) {
  const priorPrec = 1 / prior.sigma2;
  const obsPrec = 1 / noiseVar;
  const postPrec = priorPrec + obsPrec;
  const mu = (priorPrec * prior.mu + obsPrec * impliedSkill) / postPrec;
  return { mu: clamp(mu, 0.02, 0.98), sigma2: 1 / postPrec };
}

function tierSeverity(tierIdx) {
  const tier = DIFF_TIERS[tierIdx];
  const gNorm = (tier.gravity - 0.008) / (0.031 - 0.008);
  const windNorm = tier.wind / 1.8;
  const fuelNorm = 1 - tier.fuel / 110;
  return clamp(0.45 * (tierIdx / 9) + 0.30 * windNorm + 0.15 * gNorm + 0.10 * fuelNorm, 0, 1);
}

function estimateSuccess(tierIdx, padIdx, skill = 0.5) {
  const sev = tierSeverity(tierIdx);
  const pad = PADS[padIdx];
  const z =
    1.45 -
    2.1 * sev +
    1.3 * Math.log(pad.width / 110) +
    2.3 * (clamp(skill, 0.02, 0.98) - 0.5);
  return clamp(sigmoid(z), 0.04, 0.96);
}

function createEmptyMarketBook() {
  return Array.from({ length: DIFF_TIERS.length }, () =>
    Array.from({ length: PADS.length }, () => ({ s: 0, f: 0 }))
  );
}

function loadMarketBook() {
  if (typeof window === "undefined") return createEmptyMarketBook();
  try {
    const raw = window.localStorage.getItem(MARKET_BOOK_KEY);
    if (!raw) return createEmptyMarketBook();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== DIFF_TIERS.length) return createEmptyMarketBook();
    return parsed.map((row) =>
      Array.isArray(row) && row.length === PADS.length
        ? row.map((cell) => ({
            s: Number(cell?.s) || 0,
            f: Number(cell?.f) || 0,
          }))
        : Array.from({ length: PADS.length }, () => ({ s: 0, f: 0 }))
    );
  } catch {
    return createEmptyMarketBook();
  }
}

function saveMarketBook(book) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKET_BOOK_KEY, JSON.stringify(book));
  } catch {}
}

function totalLocalMarketObservations(book) {
  let n = 0;
  for (const row of book) for (const cell of row) n += (cell?.s || 0) + (cell?.f || 0);
  return n;
}

function roundRiskFreeRate(tierIdx) {
  const sev = tierSeverity(tierIdx);
  return clamp(BASE_RISK_FREE_RATE * (1 - sev) + MIN_RISK_FREE_RATE * sev, MIN_RISK_FREE_RATE, BASE_RISK_FREE_RATE);
}

function skillClarity(skillSigma2) {
  const baseSd = Math.sqrt(0.14);
  const sd = Math.sqrt(Math.max(1e-6, skillSigma2));
  return clamp(1 - sd / baseSd, 0, 1);
}

function quotedProfitMult(qQuote, riskFreeRate, promoEdge) {
  const q = clamp(qQuote, 0.12, 0.96);
  return (1 + riskFreeRate + promoEdge) / q - 1;
}

function marketPosteriorProb(book, tierIdx, padIdx) {
  const cell = book?.[tierIdx]?.[padIdx] || { s: 0, f: 0 };
  const priorQ = estimateSuccess(tierIdx, padIdx, 0.5);
  const alpha = priorQ * MARKET_PRIOR_STRENGTH + (cell.s || 0);
  const beta = (1 - priorQ) * MARKET_PRIOR_STRENGTH + (cell.f || 0);
  return clamp(alpha / (alpha + beta), 0.04, 0.96);
}

function marketQuote({ marketBook, tierIdx, padIdx, skillMu, skillSigma2 }) {
  const qBook = marketPosteriorProb(marketBook, tierIdx, padIdx);
  const qPersonal = estimateSuccess(tierIdx, padIdx, skillMu);
  const clarity = skillClarity(skillSigma2);
  const personalWeight = clamp(
    0.12 + 0.58 * clarity + 0.18 * Math.abs(skillMu - 0.5) * 2,
    0.12,
    0.86
  );
  const qQuote = clamp((1 - personalWeight) * qBook + personalWeight * qPersonal, 0.04, 0.96);
  const riskFreeRate = roundRiskFreeRate(tierIdx);
  const baseEdge = PAD_EDGE_BASE[padIdx];
  const floorEdge = PAD_EDGE_FLOOR[padIdx];
  const skillPressure = clamp(0.72 * clarity + 0.20 * Math.max(0, skillMu - 0.5) * 2, 0, 0.92);
  const promoEdge = clamp(Math.max(floorEdge, baseEdge * (1 - skillPressure)), floorEdge, baseEdge);
  return {
    qBook,
    qPersonal,
    qQuote,
    riskFreeRate,
    promoEdge,
    profitMult: quotedProfitMult(qQuote, riskFreeRate, promoEdge),
    personalWeight,
    clarity,
  };
}

function expectedFuelUsedFrac(tierIdx, padIdx, skill = 0.5) {
  const sev = tierSeverity(tierIdx);
  const padRisk = PADS[padIdx].risk;
  return clamp(0.30 + 0.22 * sev + 0.14 * padRisk + 0.18 * (1 - clamp(skill, 0, 1)), 0.16, 0.94);
}

function expectedFuelLeftFrac(tierIdx, padIdx, skill = 0.5) {
  return clamp(1 - expectedFuelUsedFrac(tierIdx, padIdx, skill), 0.06, 0.85);
}

function subjectiveSuccess(qObj, edgeBias) {
  return clamp(sigmoid(logit(qObj) + edgeBias), 0.03, 0.97);
}

function nearestFractionGrid(frac) {
  let bestIdx = 0;
  let bestErr = Infinity;
  for (let i = 0; i < FRACTION_GRID.length; i++) {
    const err = Math.abs(FRACTION_GRID[i] - frac);
    if (err < bestErr) {
      bestErr = err;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function economicPreview({ wealth, tierIdx, padIdx, betFrac, skillMu, skillSigma2, marketBook }) {
  const quote = marketQuote({ marketBook, tierIdx, padIdx, skillMu, skillSigma2 });
  const bet = Math.round(wealth * betFrac);
  const cash = wealth - bet;
  const expectedBonusPct = PADS[padIdx].fuelBonusCapPct * expectedFuelLeftFrac(tierIdx, padIdx, skillMu);
  const failWealth = Math.round(cash * (1 + quote.riskFreeRate));
  const successWealth = Math.round(cash * (1 + quote.riskFreeRate) + bet * (1 + quote.profitMult));
  const expectedSuccessWithFuel = Math.round(successWealth + bet * expectedBonusPct);
  const averagePilotEV = quote.promoEdge;
  return {
    ...quote,
    bet,
    failWealth,
    successWealth,
    expectedSuccessWithFuel,
    expectedBonusPct,
    averagePilotEV,
  };
}

function actionLogLikelihoods({ wealth, tierIdx, chosenPadIdx, betFrac, skillMu, skillSigma2, marketBook }) {
  const quotes = PADS.map((_, pi) =>
    marketQuote({ marketBook, tierIdx, padIdx: pi, skillMu, skillSigma2 })
  );
  const expectedBonusPct = PADS.map(
    (pad, pi) => pad.fuelBonusCapPct * expectedFuelLeftFrac(tierIdx, pi, skillMu)
  );
  const obsFracIdx = nearestFractionGrid(betFrac);
  const obsActionIdx = chosenPadIdx * FRACTION_GRID.length + obsFracIdx;
  const tau = Math.max(100, wealth * ACTION_TAU_FRAC);

  const logLike = new Array(GAMMA_GRID.length * EDGE_GRID.length).fill(0);

  for (let gi = 0; gi < GAMMA_GRID.length; gi++) {
    const gamma = GAMMA_GRID[gi];
    for (let ei = 0; ei < EDGE_GRID.length; ei++) {
      const edge = EDGE_GRID[ei];
      const scores = [];
      let maxScore = -Infinity;
      let obsScore = -Infinity;

      for (let pi = 0; pi < PADS.length; pi++) {
        const qSubj = subjectiveSuccess(quotes[pi].qPersonal, edge);
        for (let fi = 0; fi < FRACTION_GRID.length; fi++) {
          const f = FRACTION_GRID[fi];
          const bet = wealth * f;
          const cash = wealth - bet;
          const wSuccess =
            cash * (1 + quotes[pi].riskFreeRate) +
            bet * (1 + quotes[pi].profitMult + expectedBonusPct[pi]);
          const wFail = cash * (1 + quotes[pi].riskFreeRate);
          const eu =
            qSubj * crraUtil(wSuccess, gamma) +
            (1 - qSubj) * crraUtil(wFail, gamma);
          const ce = invCrraUtil(eu, gamma);
          const score = ce / tau;
          scores.push(score);
          if (score > maxScore) maxScore = score;
          if (pi * FRACTION_GRID.length + fi === obsActionIdx) obsScore = score;
        }
      }

      let sumExp = 0;
      for (let i = 0; i < scores.length; i++) sumExp += Math.exp(scores[i] - maxScore);
      logLike[flattenIndex(gi, ei)] = obsScore - maxScore - Math.log(sumExp);
    }
  }

  return logLike;
}

function fuelGammaLogLikelihoods(fuelSafetyScore) {
  const s = clamp(fuelSafetyScore, 0, 1);
  const impliedGamma = 0.7 + 2.1 * s;
  const sigma = 1.45;
  return GAMMA_GRID.map((g) => -0.5 * Math.pow((g - impliedGamma) / sigma, 2));
}

function fuelSafetyScore({ tierIdx, padIdx, skillMu, fuel, maxFuel, belowMinRatio, slackAvg }) {
  const slackScore = clamp((slackAvg - 0.015) / 0.22, 0, 1);
  const fuelUsedFrac = 1 - fuel / Math.max(1, maxFuel);
  const expected = expectedFuelUsedFrac(tierIdx, padIdx, skillMu);
  const excessBurn = clamp((fuelUsedFrac - expected) / 0.24, -1, 1);
  const burnCaution = clamp(0.5 + 0.5 * excessBurn * (0.35 + 0.65 * skillMu), 0, 1);
  return clamp(0.55 * slackScore + 0.30 * burnCaution + 0.15 * (1 - clamp(belowMinRatio, 0, 1)), 0, 1);
}

function getGammaProfile(gamma) {
  return GAMMA_PROFILES.find((p) => gamma <= p.max) || GAMMA_PROFILES[GAMMA_PROFILES.length - 1];
}

function getEdgeProfile(edge) {
  return EDGE_PROFILES.find((p) => edge <= p.max) || EDGE_PROFILES[EDGE_PROFILES.length - 1];
}

function genRoundOrder() {
  const mid = [1, 2, 3, 4, 5, 6, 7, 8];
  for (let i = mid.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mid[i], mid[j]] = [mid[j], mid[i]];
  }
  return [0, ...mid, 9];
}

function calcMinSafeFuel(vy, altitude, gravity, maxFuel) {
  const net = THRUST - gravity;
  if (net <= 0) return maxFuel;
  const dv = Math.max(0, vy - SAFE_V * 0.8);
  return Math.min(maxFuel, dv / net * FUEL_RATE * 1.3 + 2);
}

function genStars(n) {
  return Array.from({ length: n }, () => ({
    x: Math.random() * W,
    y: Math.random() * (GROUND_Y - 30),
    s: Math.random() * 1.4 + 0.4,
    b: Math.random(),
    t: Math.random() * 0.03 + 0.004,
  }));
}

function genPadPositions() {
  const order = [0, 1, 2].sort(() => Math.random() - 0.5);
  const spacing = W / 4;
  return order.map((pi, pos) => ({
    idx: pi,
    x: spacing * (pos + 1) + (Math.random() - 0.5) * 28,
    w: PADS[pi].width,
  }));
}

function genTerrain(pads) {
  const pts = [];
  for (let x = 0; x <= W; x += 3) {
    let y = GROUND_Y + Math.sin(x * 0.015) * 10 + Math.sin(x * 0.038) * 5;
    for (const p of pads) {
      if (x >= p.x - p.w / 2 - 8 && x <= p.x + p.w / 2 + 8) y = GROUND_Y;
    }
    pts.push({ x, y });
  }
  return pts;
}

function groundYAtX(terrain, x) {
  const i = Math.max(0, Math.min(terrain.length - 2, Math.floor(x / 3)));
  const a = terrain[i];
  const b = terrain[i + 1];
  if (!a || !b) return GROUND_Y;
  const t = (x - a.x) / (b.x - a.x + 0.001);
  return a.y + t * (b.y - a.y);
}

function drawScene(ctx, g, pads, terrain, targetPadIdx, time, particles, stars, isPreview) {
  ctx.fillStyle = "#06080f";
  ctx.fillRect(0, 0, W, H);

  for (const s of stars) {
    const br = 0.2 + 0.8 * ((Math.sin((time || 0) * s.t + s.b * 10) + 1) / 2);
    ctx.fillStyle = `rgba(200,210,255,${br * 0.75})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(0, H);
  for (const pt of terrain) ctx.lineTo(pt.x, pt.y);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = "#12162a";
  ctx.fill();

  ctx.strokeStyle = "#283049";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < terrain.length; i++) {
    if (i === 0) ctx.moveTo(terrain[i].x, terrain[i].y);
    else ctx.lineTo(terrain[i].x, terrain[i].y);
  }
  ctx.stroke();

  for (const pad of pads) {
    const cfg = PADS[pad.idx];
    const isTarget = pad.idx === targetPadIdx;
    if (isTarget) {
      ctx.shadowColor = cfg.color;
      ctx.shadowBlur = isPreview ? 12 : 16;
    }
    ctx.fillStyle = isTarget ? cfg.color : cfg.color + (isPreview ? "88" : "55");
    ctx.fillRect(pad.x - pad.w / 2, GROUND_Y - 3, pad.w, 6);
    ctx.shadowBlur = 0;

    ctx.fillStyle = isTarget ? "#fff" : isPreview ? "#a7b2d1" : "#6b7280";
    ctx.fillRect(pad.x - pad.w / 2, GROUND_Y - 10, 2, 14);
    ctx.fillRect(pad.x + pad.w / 2 - 2, GROUND_Y - 10, 2, 14);

    ctx.textAlign = "center";
    ctx.font = isPreview ? "bold 11px monospace" : "10px monospace";
    ctx.fillStyle = isTarget ? cfg.color : isPreview ? "#9ca3af" : "#6b7280";
    ctx.fillText(cfg.label, pad.x, GROUND_Y - 16);
  }

  if (particles) {
    for (const p of particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  if (g) {
    if (isPreview) {
      ctx.strokeStyle = "#475569";
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(g.x, 18);
      ctx.lineTo(g.x, GROUND_Y - 40);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "10px monospace";
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "center";
      ctx.fillText("START", g.x, 14);
    }

    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rotation || 0);

    if (g.keys?.up && g.fuel > 0 && !g.done) {
      ctx.fillStyle = Math.sin((time || 0) * 0.4) > 0 ? "#ffdd55" : "#ff8c00";
      ctx.beginPath();
      ctx.moveTo(-5, 16);
      ctx.lineTo(0, 28 + Math.random() * 8);
      ctx.lineTo(5, 16);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = "#dbe4ff";
    ctx.fillRect(-6, -14, 12, 28);
    ctx.beginPath();
    ctx.moveTo(-6, -14);
    ctx.lineTo(0, -23);
    ctx.lineTo(6, -14);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, 12);
    ctx.lineTo(-12, 18);
    ctx.moveTo(6, 12);
    ctx.lineTo(12, 18);
    ctx.stroke();

    ctx.fillStyle = "#0ea5e9";
    ctx.fillRect(-4, -6, 8, 12);

    ctx.restore();
  }
}

function DistributionStrip({ values, color }) {
  const max = Math.max(...values, 1e-9);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${values.length}, 1fr)`,
        gap: "1px",
        alignItems: "end",
        height: "34px",
        background: "rgba(255,255,255,0.02)",
        padding: "3px",
        borderRadius: "6px",
        border: "1px solid #1e293b",
      }}
    >
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            height: `${Math.max(3, (v / max) * 100)}%`,
            background: color,
            opacity: 0.2 + 0.8 * (v / max),
            borderRadius: "2px 2px 0 0",
          }}
        />
      ))}
    </div>
  );
}

function btnStyle(color = "#0ea5e9") {
  return {
    padding: "11px 18px",
    borderRadius: "8px",
    border: `1px solid ${color}`,
    background: `${color}1f`,
    color: "#e2e8f0",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "system-ui, sans-serif",
    transition: "all 0.15s ease",
  };
}

function smallPill(selected, color = "#334155") {
  return {
    padding: "6px 10px",
    borderRadius: "999px",
    border: `1px solid ${selected ? color : "#334155"}`,
    background: selected ? `${color}25` : "transparent",
    color: selected ? "#e2e8f0" : "#94a3b8",
    cursor: "pointer",
    fontSize: "12px",
  };
}

export default function RocketLander() {
  const canvasRef = useRef(null);
  const animRef = useRef(0);
  const gameRef = useRef(null);
  const terrainRef = useRef([]);
  const padsRef = useRef([]);
  const particlesRef = useRef([]);
  const starsRef = useRef(genStars(90));
  const lastTRef = useRef(0);
  const decisionRef = useRef(null);
  const flightMetricsRef = useRef({ framesBelowMin: 0, totalFrames: 0, slackSum: 0 });

  const [phase, setPhase] = useState("menu");
  const [roundOrder, setRoundOrder] = useState(() => genRoundOrder());
  const [round, setRound] = useState(1);
  const [chosenPadIdx, setChosenPadIdx] = useState(-1);
  const [padPositions, setPadPositions] = useState([]);
  const [terrain, setTerrain] = useState([]);
  const [wealth, setWealth] = useState(START_WEALTH);
  const [betPct, setBetPct] = useState(20);
  const [posterior, setPosterior] = useState(() => createJointPrior());
  const [skillState, setSkillState] = useState(createSkillState);
  const [marketBook, setMarketBook] = useState(() => loadMarketBook());
  const [lastResult, setLastResult] = useState(null);
  const [roundHistory, setRoundHistory] = useState([]);
  const [shakeOffset, setShakeOffset] = useState({ x: 0, y: 0 });
  const [lastInsight, setLastInsight] = useState("");

  const currentTierIdx = roundOrder[round - 1] ?? 0;
  const currentTier = DIFF_TIERS[currentTierIdx];
  const currentRiskFreeRate = roundRiskFreeRate(currentTierIdx);
  const skill = skillState.mu;
  const skillCertainty = skillClarity(skillState.sigma2);
  const marketObs = useMemo(() => totalLocalMarketObservations(marketBook), [marketBook]);
  const betFrac = clamp(betPct / 100, 0, 1);
  const plannedBet = Math.round(wealth * betFrac);

  const posteriorStats = useMemo(() => jointPosteriorStats(posterior), [posterior]);
  const gamma = posteriorStats.gammaMean;
  const edge = posteriorStats.edgeMean;
  const gammaProfile = getGammaProfile(gamma);
  const edgeProfile = getEdgeProfile(edge);

  const currentQuotes = useMemo(
    () =>
      PADS.map((_, i) =>
        marketQuote({
          marketBook,
          tierIdx: currentTierIdx,
          padIdx: i,
          skillMu: skillState.mu,
          skillSigma2: skillState.sigma2,
        })
      ),
    [marketBook, currentTierIdx, skillState.mu, skillState.sigma2]
  );

  const selectedPreview = useMemo(() => {
    if (chosenPadIdx < 0) return null;
    return economicPreview({
      wealth,
      tierIdx: currentTierIdx,
      padIdx: chosenPadIdx,
      betFrac,
      skillMu: skill,
      skillSigma2: skillState.sigma2,
      marketBook,
    });
  }, [wealth, currentTierIdx, chosenPadIdx, betFrac, skill, skillState.sigma2, marketBook]);

  useEffect(() => {
    terrainRef.current = terrain;
  }, [terrain]);

  useEffect(() => {
    saveMarketBook(marketBook);
  }, [marketBook]);

  useEffect(() => {
    padsRef.current = padPositions;
  }, [padPositions]);

  const recordMarketOutcome = useCallback((tierIdx, padIdx, success) => {
    setMarketBook((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ s: cell.s, f: cell.f })));
      if (!next[tierIdx] || !next[tierIdx][padIdx]) return prev;
      if (success) next[tierIdx][padIdx].s += 1;
      else next[tierIdx][padIdx].f += 1;
      return next;
    });
  }, []);

  const resetLocalBook = useCallback(() => {
    setMarketBook(createEmptyMarketBook());
  }, []);

  const initRound = useCallback((rNum, order) => {
    const pads = genPadPositions();
    const terr = genTerrain(pads);
    const tierIdx = order[rNum - 1];
    const tier = DIFF_TIERS[tierIdx];

    setPadPositions(pads);
    setTerrain(terr);
    setChosenPadIdx(-1);
    setBetPct(20);
    setLastResult(null);
    decisionRef.current = null;
    particlesRef.current = [];
    flightMetricsRef.current = { framesBelowMin: 0, totalFrames: 0, slackSum: 0 };
    lastTRef.current = 0;

    gameRef.current = {
      x: W / 2 + (Math.random() - 0.5) * 120,
      y: START_Y[tierIdx],
      vx: (Math.random() - 0.5) * 0.3,
      vy: 0,
      fuel: tier.fuel,
      maxFuel: tier.fuel,
      gravity: tier.gravity,
      windStr: tier.wind,
      wind: 0,
      rotation: 0,
      time: 0,
      keys: { up: false, left: false, right: false },
      done: false,
      tierIdx,
    };
  }, []);

  const startGame = () => {
    const order = genRoundOrder();
    setRoundOrder(order);
    setRound(1);
    setWealth(START_WEALTH);
    setPosterior(createJointPrior());
    setSkillState(createSkillState());
    setRoundHistory([]);
    setLastInsight("");
    setShakeOffset({ x: 0, y: 0 });
    initRound(1, order);
    setPhase("planning");
  };

  useEffect(() => {
    if (phase !== "planning") return;
    const c = canvasRef.current;
    if (!c || !gameRef.current) return;
    drawScene(c.getContext("2d"), gameRef.current, padsRef.current, terrainRef.current, chosenPadIdx, 0, null, starsRef.current, true);
  }, [phase, chosenPadIdx, padPositions, terrain]);

  useEffect(() => {
    const keyMap = {
      ArrowUp: "up",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      a: "left",
      d: "right",
      W: "up",
      A: "left",
      D: "right",
    };

    const onDown = (e) => {
      if (gameRef.current && keyMap[e.key]) {
        e.preventDefault();
        gameRef.current.keys[keyMap[e.key]] = true;
      }
    };
    const onUp = (e) => {
      if (gameRef.current && keyMap[e.key]) {
        e.preventDefault();
        gameRef.current.keys[keyMap[e.key]] = false;
      }
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  const touchAction = useCallback((key, state) => {
    if (gameRef.current) gameRef.current.keys[key] = state;
  }, []);

  const launchMission = () => {
    if (chosenPadIdx < 0 || !gameRef.current) return;

    const betAmount = Math.round(wealth * betFrac);
    const quote = currentQuotes[chosenPadIdx];
    const actionLL = actionLogLikelihoods({
      wealth,
      tierIdx: currentTierIdx,
      chosenPadIdx,
      betFrac,
      skillMu: skill,
      skillSigma2: skillState.sigma2,
      marketBook,
    });
    const actionWeight = 0.55 + 0.75 * betFrac;

    setPosterior((prev) => jointUpdate(prev, actionLL, actionWeight));

    decisionRef.current = {
      round,
      tierIdx: currentTierIdx,
      wealthBefore: wealth,
      betFrac,
      betAmount,
      padIdx: chosenPadIdx,
      qMarket: quote.qQuote,
      qBook: quote.qBook,
      qPersonal: quote.qPersonal,
      roundRf: quote.riskFreeRate,
      promoEdge: quote.promoEdge,
      profitMult: quote.profitMult,
      fuelBonusCapPct: PADS[chosenPadIdx].fuelBonusCapPct,
      label: PADS[chosenPadIdx].label,
    };

    setLastInsight(
      betAmount > 0
        ? `Committed ${fmt$(betAmount)} to ${PADS[chosenPadIdx].label}. Quote hit-rate ${fmtPct(quote.qQuote)}; idle cash earns ${fmtPct(quote.riskFreeRate, 1)}; promo adds ${fmtPct(quote.promoEdge, 1)} over cash on staked capital.`
        : `Paper-trading ${PADS[chosenPadIdx].label}. No capital at risk this round; unbet wealth still earns ${fmtPct(quote.riskFreeRate, 1)}.`
    );

    lastTRef.current = performance.now();
    setPhase("playing");
  };

  const applyFuelPreferenceUpdate = useCallback((decision, fuel, maxFuel) => {
    const fm = flightMetricsRef.current;
    const belowMinRatio = fm.totalFrames > 0 ? fm.framesBelowMin / fm.totalFrames : 0;
    const slackAvg = fm.totalFrames > 0 ? fm.slackSum / fm.totalFrames : 0;
    const fuelSafety = fuelSafetyScore({
      tierIdx: decision.tierIdx,
      padIdx: decision.padIdx,
      skillMu: skillState.mu,
      fuel,
      maxFuel,
      belowMinRatio,
      slackAvg,
    });
    const ll = fuelGammaLogLikelihoods(fuelSafety);
    const weight = 0.05 + 0.22 * decision.betFrac;
    setPosterior((prev) => jointUpdateGammaOnly(prev, ll, weight));
    return fuelSafety;
  }, [skillState.mu]);

  const resolveSuccess = useCallback((padIdx, speed, fuel, maxFuel) => {
    const decision = decisionRef.current;
    if (!decision) return;

    const cash = decision.wealthBefore - decision.betAmount;
    const safeWealth = Math.round(cash * (1 + decision.roundRf));
    const missionWealth = Math.round(decision.betAmount * (1 + decision.profitMult));
    const fuelFrac = fuel / Math.max(1, maxFuel);
    const fuelBonus = Math.round(decision.betAmount * decision.fuelBonusCapPct * fuelFrac);
    const wealthAfter = Math.round(safeWealth + missionWealth + fuelBonus);
    const pnl = wealthAfter - decision.wealthBefore;

    const fuelSafety = applyFuelPreferenceUpdate(decision, fuel, maxFuel);

    const impliedSkill = clamp(
      0.48 +
        0.18 * PADS[padIdx].risk +
        0.18 * (1 - tierSeverity(decision.tierIdx)) +
        0.22 * (1 - speed / HARD_V) +
        0.12 * fuelFrac,
      0.05,
      0.98
    );
    setSkillState((prev) => updateSkill(prev, impliedSkill, 0.10));
    setWealth(wealthAfter);
    recordMarketOutcome(decision.tierIdx, decision.padIdx, true);

    setLastResult({
      kind: "success",
      wealthBefore: decision.wealthBefore,
      wealthAfter,
      pnl,
      betAmount: decision.betAmount,
      betFrac: decision.betFrac,
      targetLabel: decision.label,
      landedLabel: PADS[padIdx].label,
      profitMult: decision.profitMult,
      marketQ: decision.qMarket,
      populationQ: decision.qBook,
      roundRf: decision.roundRf,
      promoEdge: decision.promoEdge,
      fuelBonus,
      fuelPct: fuelFrac,
      speed,
      fuelSafety,
    });

    setRoundHistory((prev) => [
      ...prev,
      {
        round: decision.round,
        tierIdx: decision.tierIdx,
        tierLabel: DIFF_TIERS[decision.tierIdx].label,
        target: decision.label,
        landed: PADS[padIdx].label,
        betAmount: decision.betAmount,
        betFrac: decision.betFrac,
        outcome: "success",
        marketQ: decision.qMarket,
        populationQ: decision.qBook,
        roundRf: decision.roundRf,
        promoEdge: decision.promoEdge,
        wealthBefore: decision.wealthBefore,
        wealthAfter,
        pnl,
        fuelBonus,
        speed,
      },
    ]);

    setLastInsight(
      `Mission filled. ${fmt$(decision.betAmount)} staked at +${(decision.profitMult * 100).toFixed(0)}% success return. Cash sleeve compounded at ${fmtPct(decision.roundRf, 1)} and fuel bonus added ${fmt$(fuelBonus)}.`
    );
    setPhase("result");
  }, [applyFuelPreferenceUpdate]);

  const resolveMiss = useCallback((landedPadIdx, speed, fuel, maxFuel) => {
    const decision = decisionRef.current;
    if (!decision) return;

    const cash = decision.wealthBefore - decision.betAmount;
    const wealthAfter = Math.round(cash * (1 + decision.roundRf));
    const pnl = wealthAfter - decision.wealthBefore;
    const fuelFrac = fuel / Math.max(1, maxFuel);

    const impliedSkill = clamp(
      0.28 + 0.08 * (landedPadIdx >= 0 ? 1 : 0) + 0.12 * (1 - speed / HARD_V) + 0.05 * fuelFrac,
      0.04,
      0.72
    );
    setSkillState((prev) => updateSkill(prev, impliedSkill, 0.16));
    setWealth(wealthAfter);
    recordMarketOutcome(decision.tierIdx, decision.padIdx, false);

    setLastResult({
      kind: "miss",
      wealthBefore: decision.wealthBefore,
      wealthAfter,
      pnl,
      betAmount: decision.betAmount,
      betFrac: decision.betFrac,
      targetLabel: decision.label,
      landedLabel: landedPadIdx >= 0 ? PADS[landedPadIdx].label : "Ground",
      profitMult: decision.profitMult,
      marketQ: decision.qMarket,
      populationQ: decision.qBook,
      roundRf: decision.roundRf,
      promoEdge: decision.promoEdge,
      fuelBonus: 0,
      fuelPct: fuelFrac,
      speed,
    });

    setRoundHistory((prev) => [
      ...prev,
      {
        round: decision.round,
        tierIdx: decision.tierIdx,
        tierLabel: DIFF_TIERS[decision.tierIdx].label,
        target: decision.label,
        landed: landedPadIdx >= 0 ? PADS[landedPadIdx].label : "Ground",
        betAmount: decision.betAmount,
        betFrac: decision.betFrac,
        outcome: "miss",
        marketQ: decision.qMarket,
        populationQ: decision.qBook,
        roundRf: decision.roundRf,
        promoEdge: decision.promoEdge,
        wealthBefore: decision.wealthBefore,
        wealthAfter,
        pnl,
        speed,
      },
    ]);

    setLastInsight(`Soft touchdown, but not on the contracted pad. Stake lost; idle cash still earned ${fmtPct(decision.roundRf, 1)} and the local market book recorded a miss for this contract.`);
    setPhase("result");
  }, []);

  const resolveCrash = useCallback((landedPadIdx, speed) => {
    const decision = decisionRef.current;
    if (!decision) return;

    const cash = decision.wealthBefore - decision.betAmount;
    const wealthAfter = Math.round(cash * (1 + decision.roundRf));
    const pnl = wealthAfter - decision.wealthBefore;

    const impliedSkill = clamp(0.10 + 0.05 * tierSeverity(decision.tierIdx) - 0.03 * PADS[decision.padIdx].risk, 0.02, 0.35);
    setSkillState((prev) => updateSkill(prev, impliedSkill, 0.11));
    setWealth(wealthAfter);
    recordMarketOutcome(decision.tierIdx, decision.padIdx, false);

    setLastResult({
      kind: "crash",
      wealthBefore: decision.wealthBefore,
      wealthAfter,
      pnl,
      betAmount: decision.betAmount,
      betFrac: decision.betFrac,
      targetLabel: decision.label,
      landedLabel: landedPadIdx >= 0 ? PADS[landedPadIdx].label : "Ground",
      profitMult: decision.profitMult,
      marketQ: decision.qMarket,
      populationQ: decision.qBook,
      roundRf: decision.roundRf,
      promoEdge: decision.promoEdge,
      fuelBonus: 0,
      fuelPct: 0,
      speed,
    });

    setRoundHistory((prev) => [
      ...prev,
      {
        round: decision.round,
        tierIdx: decision.tierIdx,
        tierLabel: DIFF_TIERS[decision.tierIdx].label,
        target: decision.label,
        landed: landedPadIdx >= 0 ? PADS[landedPadIdx].label : "Ground",
        betAmount: decision.betAmount,
        betFrac: decision.betFrac,
        outcome: "crash",
        marketQ: decision.qMarket,
        populationQ: decision.qBook,
        roundRf: decision.roundRf,
        promoEdge: decision.promoEdge,
        wealthBefore: decision.wealthBefore,
        wealthAfter,
        pnl,
        speed,
      },
    ]);

    let ticks = 0;
    const shakeInt = setInterval(() => {
      setShakeOffset({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8 });
      ticks += 1;
      if (ticks > 10) {
        clearInterval(shakeInt);
        setShakeOffset({ x: 0, y: 0 });
      }
    }, 36);

    setLastInsight(`Crash. The stake was lost; only unbet wealth rolled forward at ${fmtPct(decision.roundRf, 1)}. The market book logged a failed contract for this tier and pad.`);
    setPhase("result");
  }, []);

  useEffect(() => {
    if (phase !== "playing" || !gameRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    lastTRef.current = performance.now();

    const loop = (timestamp) => {
      const g = gameRef.current;
      if (!g || g.done) return;

      const rawDt = timestamp - lastTRef.current;
      lastTRef.current = timestamp;
      const dt = Math.min(rawDt, 33) / 16.67;

      g.time += dt;
      g.wind = g.windStr * (Math.sin(g.time * 0.008) + 0.6 * Math.sin(g.time * 0.031));
      g.vy += g.gravity * dt;
      g.vx += g.wind * 0.0008 * dt;

      if (g.keys.up && g.fuel > 0) {
        g.vy -= THRUST * dt;
        g.fuel = Math.max(0, g.fuel - FUEL_RATE * dt);
      }
      if (g.keys.left && g.fuel > 0) {
        g.vx -= SIDE_THRUST * dt;
        g.fuel = Math.max(0, g.fuel - SIDE_FUEL_RATE * dt);
        g.rotation = Math.max(-0.35, g.rotation - 0.025 * dt);
      } else if (g.keys.right && g.fuel > 0) {
        g.vx += SIDE_THRUST * dt;
        g.fuel = Math.max(0, g.fuel - SIDE_FUEL_RATE * dt);
        g.rotation = Math.min(0.35, g.rotation + 0.025 * dt);
      } else {
        g.rotation *= Math.pow(0.93, dt);
      }

      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.vx *= Math.pow(DRAG_X, dt);
      g.vy *= Math.pow(DRAG_Y, dt);
      g.x = Math.max(15, Math.min(W - 15, g.x));
      if (g.y < -50) g.y = -50;

      const terr = terrainRef.current;
      const localGround = groundYAtX(terr, g.x);
      const rocketBottom = g.y + 22;
      const altitude = Math.max(0, localGround - rocketBottom);
      const minFuel = calcMinSafeFuel(g.vy, altitude, g.gravity, g.maxFuel);
      const fuelPct = g.fuel / Math.max(1, g.maxFuel);
      const speed = Math.sqrt(g.vx * g.vx + g.vy * g.vy);

      flightMetricsRef.current.totalFrames += dt;
      if (g.fuel < minFuel) flightMetricsRef.current.framesBelowMin += dt;
      flightMetricsRef.current.slackSum += ((g.fuel - minFuel) / Math.max(1, g.maxFuel)) * dt;

      if (g.keys.up && g.fuel > 0 && !g.done) {
        for (let i = 0; i < 2; i++) {
          const cx = Math.cos(g.rotation);
          const sx = Math.sin(g.rotation);
          particlesRef.current.push({
            x: g.x + sx * 20 + (Math.random() - 0.5) * 5,
            y: g.y + cx * 20,
            vx: sx * 2 + (Math.random() - 0.5) * 1.4,
            vy: cx * (2 + Math.random() * 2),
            life: 15 + Math.random() * 10,
            maxLife: 25,
            color: Math.random() > 0.4 ? "#ff8c00" : "#ffdd00",
          });
        }
      }

      particlesRef.current = particlesRef.current.filter((p) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.03 * dt;
        p.life -= dt;
        return p.life > 0;
      });

      if (rocketBottom >= localGround) {
        g.done = true;
        g.y = localGround - 22;

        let touchedPadIdx = -1;
        for (const pad of padsRef.current) {
          if (g.x >= pad.x - pad.w / 2 && g.x <= pad.x + pad.w / 2) {
            touchedPadIdx = pad.idx;
            break;
          }
        }

        const softTouch = speed <= HARD_V && Math.abs(g.rotation) < MAX_TILT;
        const contractPad = decisionRef.current?.padIdx;

        if (softTouch && touchedPadIdx >= 0 && touchedPadIdx === contractPad) {
          for (let i = 0; i < 30; i++) {
            particlesRef.current.push({
              x: g.x + (Math.random() - 0.5) * 20,
              y: localGround - 2,
              vx: (Math.random() - 0.5) * 4,
              vy: -Math.random() * 2 - 0.5,
              life: 25 + Math.random() * 20,
              maxLife: 45,
              color: "#a8a29e",
            });
          }
          resolveSuccess(touchedPadIdx, speed, g.fuel, g.maxFuel);
        } else if (softTouch && touchedPadIdx >= 0) {
          for (let i = 0; i < 24; i++) {
            particlesRef.current.push({
              x: g.x + (Math.random() - 0.5) * 16,
              y: localGround - 2,
              vx: (Math.random() - 0.5) * 3,
              vy: -Math.random() * 1.6 - 0.3,
              life: 20 + Math.random() * 16,
              maxLife: 36,
              color: "#cbd5e1",
            });
          }
          resolveMiss(touchedPadIdx, speed, g.fuel, g.maxFuel);
        } else {
          for (let i = 0; i < 50; i++) {
            particlesRef.current.push({
              x: g.x + (Math.random() - 0.5) * 10,
              y: localGround - 5,
              vx: (Math.random() - 0.5) * 6,
              vy: -Math.random() * 5 - 1,
              life: 30 + Math.random() * 30,
              maxLife: 60,
              color: Math.random() > 0.5 ? "#ff6b35" : "#ffdd00",
            });
          }
          resolveCrash(touchedPadIdx, speed);
        }
      }

      drawScene(ctx, g, padsRef.current, terr, decisionRef.current?.padIdx ?? -1, g.time, particlesRef.current, starsRef.current, false);

      ctx.fillStyle = "rgba(6,8,15,0.82)";
      ctx.fillRect(8, 8, 176, 118);
      ctx.strokeStyle = "#1e293b";
      ctx.strokeRect(8, 8, 176, 118);
      ctx.font = "11px monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("ALT", 16, 28);
      ctx.fillStyle = "#e2e8f0";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(altitude / 3.5)}m`, 112, 28);
      ctx.textAlign = "left";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("VEL", 16, 46);
      ctx.fillStyle = speed <= SAFE_V ? "#4ade80" : speed <= HARD_V ? "#fbbf24" : "#ef4444";
      ctx.textAlign = "right";
      ctx.fillText(speed.toFixed(1), 112, 46);
      ctx.fillStyle = "#64748b";
      ctx.fillText("m/s", 136, 46);
      ctx.textAlign = "left";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("FUEL", 16, 64);
      ctx.fillStyle = "#64748b";
      ctx.fillText(`${Math.round(fuelPct * 100)}%`, 112, 64);
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("BET", 16, 82);
      ctx.fillStyle = "#e2e8f0";
      ctx.textAlign = "right";
      ctx.fillText(fmt$(decisionRef.current?.betAmount || 0), 160, 82);
      ctx.textAlign = "left";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("γ", 16, 100);
      ctx.fillStyle = "#0ea5e9";
      ctx.textAlign = "right";
      ctx.fillText(gamma.toFixed(1), 74, 100);
      ctx.textAlign = "left";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("EDGE", 92, 100);
      ctx.fillStyle = edge >= 0 ? "#f97316" : "#a78bfa";
      ctx.textAlign = "right";
      ctx.fillText(`${edge >= 0 ? "+" : ""}${edge.toFixed(2)}`, 160, 100);

      const barX = 62;
      const barY = 70;
      const barW = 100;
      const barH = 10;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = fuelPct > 0.30 ? "#4ade80" : fuelPct > 0.12 ? "#fbbf24" : "#ef4444";
      ctx.fillRect(barX, barY, barW * fuelPct, barH);
      const minFuelPct = Math.min(1, minFuel / Math.max(1, g.maxFuel));
      const markerX = barX + barW * minFuelPct;
      if (minFuelPct > 0.01 && minFuelPct < 0.98) {
        ctx.strokeStyle = fuelPct < minFuelPct ? "#ef4444" : "#fbbf2488";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(markerX, barY - 2);
        ctx.lineTo(markerX, barY + barH + 2);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(6,8,15,0.82)";
      ctx.fillRect(W - 206, 8, 198, 86);
      ctx.strokeStyle = "#1e293b";
      ctx.strokeRect(W - 206, 8, 198, 86);
      ctx.fillStyle = "#64748b";
      ctx.font = "10px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`ROUND ${round}/${MAX_ROUNDS}`, W - 196, 24);
      ctx.fillText(`${currentTier.label} · rf ${fmtPct(currentRiskFreeRate, 1)}`, W - 196, 40);
      if (decisionRef.current) {
        ctx.fillStyle = PADS[decisionRef.current.padIdx].color;
        ctx.font = "bold 11px monospace";
        ctx.fillText(`${decisionRef.current.label} target`, W - 196, 58);
        ctx.fillStyle = "#e2e8f0";
        ctx.textAlign = "right";
        ctx.fillText(`+${(decisionRef.current.profitMult * 100).toFixed(0)}%`, W - 18, 58);
        ctx.textAlign = "left";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(`Wealth ${fmt$(wealth)}`, W - 196, 76);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, round, currentTier, currentTierIdx, gamma, edge, wealth, resolveSuccess, resolveMiss, resolveCrash]);

  const nextStep = () => {
    if (round >= MAX_ROUNDS || wealth < BANKRUPT_FLOOR) {
      setPhase("profile");
      return;
    }
    const nextRound = round + 1;
    setRound(nextRound);
    initRound(nextRound, roundOrder);
    setPhase("planning");
  };

  const wealthDelta = wealth - START_WEALTH;
  const wealthPath = [START_WEALTH, ...roundHistory.map((r) => r.wealthAfter)];
  const wealthPeak = Math.max(...wealthPath, START_WEALTH);

  const overlayBase = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    background: "rgba(6,8,15,0.85)",
    backdropFilter: "blur(2px)",
    padding: "14px 14px 20px",
    color: "#e2e8f0",
    textAlign: "center",
    overflowY: "auto",
    overflowX: "hidden",
  };

  const summaryRow = (label, value, valueColor = "#e2e8f0") => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "20px", width: "100%", fontSize: "13px" }}>
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <span style={{ color: valueColor }}>{value}</span>
    </div>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #10162d 0%, #070b14 50%, #05070d 100%)",
        color: "#e2e8f0",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: `${W}px`,
          maxWidth: "100%",
          margin: "0 auto",
          position: "relative",
          borderRadius: "18px",
          overflow: "hidden",
          border: "1px solid #1e293b",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
          background: "#06080f",
          transform: `translate(${shakeOffset.x}px, ${shakeOffset.y}px)`,
        }}
      >
        <canvas ref={canvasRef} width={W} height={H} style={{ width: "100%", display: "block" }} />

        {phase === "playing" && (
          <div style={{ position: "absolute", top: 8, left: 8, right: 8, display: "flex", justifyContent: "space-between", gap: "6px", pointerEvents: "none", zIndex: 20 }}>
            <div style={{ pointerEvents: "auto", background: "rgba(6,8,15,0.8)", border: "1px solid #1e293b", borderRadius: "10px", padding: "8px 12px", minWidth: "180px" }}>
              <div style={{ fontSize: "10px", color: "#64748b", letterSpacing: "1px" }}>TOTAL WEALTH</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: wealth >= START_WEALTH ? "#4ade80" : "#fbbf24" }}>{fmt$(wealth)}</div>
              <div style={{ fontSize: "11px", color: wealthDelta >= 0 ? "#4ade80" : "#f87171" }}>{wealthDelta >= 0 ? "+" : ""}{fmt$(wealthDelta)} vs start</div>
            </div>
            <div style={{ pointerEvents: "auto", background: "rgba(6,8,15,0.8)", border: "1px solid #1e293b", borderRadius: "10px", padding: "8px 12px", minWidth: "220px" }}>
              <div style={{ fontSize: "10px", color: "#64748b", letterSpacing: "1px" }}>POSTERIOR NOW</div>
              <div style={{ display: "flex", gap: "18px", marginTop: "2px", fontSize: "13px" }}>
                <div>γ <span style={{ color: "#0ea5e9", fontWeight: 700 }}>{gamma.toFixed(1)}</span></div>
                <div>edge <span style={{ color: edge >= 0 ? "#f97316" : "#a78bfa", fontWeight: 700 }}>{edge >= 0 ? "+" : ""}{edge.toFixed(2)}</span></div>
                <div>skill <span style={{ color: "#22c55e", fontWeight: 700 }}>{skill.toFixed(2)}</span></div>
              </div>
              <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>Quotes blend local play history with your observed skill. Promo edge is larger on safer missions and compresses as skill becomes clearer.</div>
            </div>
          </div>
        )}

        {phase === "menu" && (
          <div style={overlayBase}>
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#38bdf8", marginBottom: "8px" }}>ROCKET LANDER · WEALTH EDITION</div>
            <h1 style={{ fontSize: "28px", margin: "0 0 8px" }}>Adaptive market, explicit stakes.</h1>
            <p style={{ maxWidth: "560px", color: "#94a3b8", lineHeight: 1.6, fontSize: "14px", margin: "0 0 18px" }}>
              You begin with <strong>{fmt$(START_WEALTH)}</strong>. Each round you choose a mission, size the stake, then actually fly it.
              Unbet cash earns a round-specific risk-free return that falls as conditions get harder. Mission quotes are <strong>risk-neutral first</strong>, then receive a small promo edge that is larger on safer missions and shrinks as your skill becomes clearer.
            </p>
            <div style={{ maxWidth: "560px", background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px 16px", marginBottom: "20px", textAlign: "left", fontSize: "13px", lineHeight: 1.6, color: "#cbd5e1" }}>
              <div><span style={{ color: "#4ade80" }}>① Risk-neutral baseline</span> means success payouts include the round&apos;s cash return before any promo edge is added.</div>
              <div><span style={{ color: "#fbbf24" }}>② Adaptive quotes</span> blend local play history with your inferred skill, then give safer missions a slightly larger subsidy.</div>
              <div><span style={{ color: "#f87171" }}>③ Fuel left</span> still matters: efficient landings lift realised P&amp;L, while excess safety burn is a weak caution signal.</div>
            </div>
            <div style={{ display: "flex", gap: "18px", marginBottom: "18px", fontSize: "12px", color: "#64748b" }}>
              <span>↑ / W thrust</span>
              <span>← → / A D steer</span>
              <span>10 rounds</span>
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button onClick={startGame} style={btnStyle("#0ea5e9")}>START SESSION</button>
              <button onClick={resetLocalBook} style={btnStyle("#334155")}>RESET LOCAL BOOK</button>
            </div>
            <div style={{ marginTop: "10px", fontSize: "11px", color: "#64748b" }}>Local market observations stored in this browser: {marketObs}</div>
          </div>
        )}

        {phase === "planning" && (
          <div style={{ ...overlayBase, paddingTop: "10px", background: "rgba(6,8,15,0.82)" }}>
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#64748b", marginBottom: "4px" }}>ROUND {round} OF {MAX_ROUNDS}</div>
            <h2 style={{ margin: "0 0 2px", fontSize: "20px" }}>Allocate capital for this mission</h2>
            <p style={{ color: "#94a3b8", fontSize: "13px", margin: "0 0 14px" }}>
              {currentTier.label} · Cash not staked earns {fmtPct(currentRiskFreeRate, 1)} this round · local market book {marketObs} obs
            </p>
            {lastInsight && <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "10px", fontStyle: "italic" }}>{lastInsight}</div>}

            <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap", justifyContent: "center", maxWidth: "680px" }}>
              {PADS.map((pad, i) => {
                const quote = currentQuotes[i];
                const selected = chosenPadIdx === i;
                return (
                  <button
                    key={pad.label}
                    onClick={() => setChosenPadIdx(i)}
                    style={{
                      width: "190px",
                      padding: "10px 10px 8px",
                      borderRadius: "10px",
                      border: `2px solid ${selected ? pad.color : "#1e293b"}`,
                      background: selected ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)",
                      color: "#e2e8f0",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: pad.color }}>{pad.label}</div>
                      <div style={{ fontSize: "10px", color: "#64748b" }}>adaptive quote</div>
                    </div>
                    <div style={{ fontSize: "12px", color: "#cbd5e1", marginBottom: "6px", minHeight: "24px" }}>{pad.desc}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", fontSize: "12px", marginBottom: "8px" }}>
                      <div>
                        <div style={{ color: "#64748b", fontSize: "10px" }}>HIT-RATE</div>
                        <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{fmtPct(quote.qQuote)}</div>
                      </div>
                      <div>
                        <div style={{ color: "#64748b", fontSize: "10px" }}>SUCCESS RETURN</div>
                        <div style={{ color: pad.color, fontWeight: 700 }}>+{(quote.profitMult * 100).toFixed(0)}%</div>
                      </div>
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                      Population {fmtPct(quote.qBook)} · rf {fmtPct(quote.riskFreeRate, 1)} · promo +{fmtPct(quote.promoEdge, 2)}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>Fuel bonus: up to +{(pad.fuelBonusCapPct * 100).toFixed(0)}% of stake on a fuel-efficient landing.</div>
                  </button>
                );
              })}
            </div>

            <div style={{ width: "100%", maxWidth: "620px", background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "12px", padding: "14px 16px", marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: "11px", color: "#64748b", letterSpacing: "1px" }}>STAKE</div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: plannedBet > 0 ? "#fbbf24" : "#94a3b8" }}>{fmt$(plannedBet)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "11px", color: "#64748b", letterSpacing: "1px" }}>FRACTION OF WEALTH</div>
                  <div style={{ fontSize: "20px", fontWeight: 700 }}>{betPct}%</div>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={betPct}
                onChange={(e) => setBetPct(Number(e.target.value))}
                style={{ width: "100%", marginBottom: "10px" }}
              />
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                {[0, 5, 10, 20, 35, 50, 75, 100].map((p) => (
                  <button key={p} onClick={() => setBetPct(p)} style={smallPill(betPct === p, "#334155")}>{p}%</button>
                ))}
              </div>
            </div>

            {selectedPreview && chosenPadIdx >= 0 && (
              <div style={{ width: "100%", maxWidth: "620px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "10px", padding: "12px", textAlign: "left" }}>
                  <div style={{ fontSize: "11px", color: "#64748b", letterSpacing: "1px", marginBottom: "8px" }}>OUTCOME PREVIEW</div>
                  {summaryRow("If mission fails", fmt$(selectedPreview.failWealth), plannedBet > 0 ? "#f87171" : "#e2e8f0")}
                  {summaryRow("If mission succeeds", fmt$(selectedPreview.successWealth), "#4ade80")}
                  {summaryRow("Expected success with fuel", fmt$(selectedPreview.expectedSuccessWithFuel), "#22c55e")}
                  {summaryRow("Fuel bonus expectation", `~${fmt$(plannedBet * selectedPreview.expectedBonusPct)}`, "#22c55e")}
                </div>
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "10px", padding: "12px", textAlign: "left" }}>
                  <div style={{ fontSize: "11px", color: "#64748b", letterSpacing: "1px", marginBottom: "8px" }}>QUOTE QUALITY</div>
                  {summaryRow("Population hit-rate", fmtPct(selectedPreview.qBook), "#94a3b8")}
                  {summaryRow("Your quoted hit-rate", fmtPct(selectedPreview.qQuote), PADS[chosenPadIdx].color)}
                  {summaryRow("Return on success", `+${(selectedPreview.profitMult * 100).toFixed(0)}% of stake`, PADS[chosenPadIdx].color)}
                  {summaryRow("Cash sleeve rf", fmtPct(selectedPreview.riskFreeRate, 1), "#4ade80")}
                  {summaryRow("Promo over cash", `+${(selectedPreview.averagePilotEV * 100).toFixed(2)}%`, "#4ade80")}
                  <div style={{ color: "#64748b", fontSize: "11px", marginTop: "8px", lineHeight: 1.5 }}>
                    Safer missions keep a slightly larger subsidy. As the game becomes more certain about your skill, the quote leans more toward your own demonstrated hit-rate and the subsidy compresses.
                  </div>
                </div>
              </div>
            )}

            <div style={{ width: "100%", maxWidth: "620px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "10px", padding: "10px", textAlign: "left" }}>
                <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "6px" }}>γ posterior · {posteriorStats.gammaLo95.toFixed(1)} to {posteriorStats.gammaHi95.toFixed(1)}</div>
                <DistributionStrip values={posteriorStats.gammaMarginal} color="#0ea5e9" />
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "10px", padding: "10px", textAlign: "left" }}>
                <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "6px" }}>Edge posterior · {posteriorStats.edgeLo95.toFixed(2)} to {posteriorStats.edgeHi95.toFixed(2)}</div>
                <DistributionStrip values={posteriorStats.edgeMarginal} color={edge >= 0 ? "#f97316" : "#a78bfa"} />
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={launchMission} disabled={chosenPadIdx < 0} style={{ ...btnStyle(chosenPadIdx >= 0 ? PADS[chosenPadIdx].color : "#334155"), opacity: chosenPadIdx >= 0 ? 1 : 0.55, cursor: chosenPadIdx >= 0 ? "pointer" : "not-allowed" }}>
                LAUNCH MISSION
              </button>
              <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                Current read: <span style={{ color: "#0ea5e9", fontWeight: 700 }}>{gammaProfile.title}</span> · <span style={{ color: edge >= 0 ? "#f97316" : "#a78bfa", fontWeight: 700 }}>{edgeProfile.title}</span> · skill clarity {(skillCertainty * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        )}

        {phase === "playing" && (
          <>
            <div style={{ position: "absolute", bottom: "8px", left: 0, right: 0, display: "flex", justifyContent: "center", gap: "12px", zIndex: 6, pointerEvents: "none" }}>
              {[ ["left", "←"], ["up", "▲"], ["right", "→"] ].map(([key, label]) => (
                <button
                  key={key}
                  onTouchStart={(e) => { e.preventDefault(); touchAction(key, true); }}
                  onTouchEnd={(e) => { e.preventDefault(); touchAction(key, false); }}
                  onMouseDown={() => touchAction(key, true)}
                  onMouseUp={() => touchAction(key, false)}
                  onMouseLeave={() => touchAction(key, false)}
                  style={{
                    pointerEvents: "auto",
                    width: "56px",
                    height: "56px",
                    borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#cbd5e1",
                    fontSize: "20px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    userSelect: "none",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "6px 14px", background: "rgba(6,8,15,0.88)", fontSize: "11px", zIndex: 5, fontFamily: "monospace" }}>
              <span style={{ color: "#4ade80" }}>WEALTH: {fmt$(wealth)}</span>
              <span style={{ color: "#fbbf24" }}>AT RISK: {fmt$(decisionRef.current?.betAmount || 0)}</span>
              <span style={{ color: "#94a3b8" }}>γ {gamma.toFixed(1)} · edge {edge >= 0 ? "+" : ""}{edge.toFixed(2)}</span>
            </div>
          </>
        )}

        {phase === "result" && lastResult && (
          <div style={overlayBase}>
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: lastResult.kind === "success" ? "#4ade80" : lastResult.kind === "miss" ? "#fbbf24" : "#ef4444", marginBottom: "6px" }}>
              {lastResult.kind === "success" ? "MISSION FILLED" : lastResult.kind === "miss" ? "OFF-CONTRACT LANDING" : "CRASH"}
            </div>
            <h2 style={{ fontSize: "24px", margin: "0 0 8px", color: lastResult.pnl >= 0 ? "#4ade80" : "#fbbf24" }}>{fmtSigned$(lastResult.pnl)}</h2>
            <div style={{ fontSize: "14px", color: "#94a3b8", marginBottom: "18px" }}>Wealth now <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{fmt$(lastResult.wealthAfter)}</span></div>

            <div style={{ width: "100%", maxWidth: "460px", background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "12px", padding: "14px 16px", marginBottom: "16px" }}>
              {summaryRow("Target mission", lastResult.targetLabel, PADS.find((p) => p.label === lastResult.targetLabel)?.color || "#e2e8f0")}
              {summaryRow("Actual touchdown", lastResult.landedLabel)}
              {summaryRow("Stake", fmt$(lastResult.betAmount), "#fbbf24")}
              {summaryRow("Quoted success return", `+${(lastResult.profitMult * 100).toFixed(0)}%`)}
              {summaryRow("Population hit-rate", fmtPct(lastResult.populationQ), "#94a3b8")}
              {summaryRow("Quoted hit-rate", fmtPct(lastResult.marketQ))}
              {summaryRow("Cash sleeve rf", fmtPct(lastResult.roundRf, 1), "#4ade80")}
              {summaryRow("Promo over cash", `+${(lastResult.promoEdge * 100).toFixed(2)}%`, "#4ade80")}
              {summaryRow("Touchdown speed", `${lastResult.speed.toFixed(2)} m/s`, lastResult.speed <= SAFE_V ? "#4ade80" : lastResult.speed <= HARD_V ? "#fbbf24" : "#ef4444")}
              {lastResult.kind === "success" && summaryRow("Fuel bonus", fmt$(lastResult.fuelBonus), "#22c55e")}
            </div>

            <div style={{ maxWidth: "500px", fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, marginBottom: "18px" }}>{lastInsight}</div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={nextStep} style={btnStyle(lastResult.kind === "success" ? "#22c55e" : "#0ea5e9")}>{round >= MAX_ROUNDS || wealth < BANKRUPT_FLOOR ? "SEE PROFILE" : "NEXT ROUND"}</button>
            </div>
          </div>
        )}

        {phase === "profile" && (
          <div style={{ ...overlayBase, paddingTop: "10px" }}>
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#38bdf8", marginBottom: "6px" }}>SESSION COMPLETE</div>
            <h2 style={{ fontSize: "24px", margin: "0 0 6px" }}>{fmt$(wealth)}</h2>
            <div style={{ color: wealth >= START_WEALTH ? "#4ade80" : "#f87171", fontSize: "14px", marginBottom: "18px" }}>{wealth >= START_WEALTH ? "+" : ""}{fmt$(wealth - START_WEALTH)} vs starting wealth</div>

            <div style={{ width: "100%", maxWidth: "650px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "12px", padding: "14px", textAlign: "left" }}>
                <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "6px" }}>RISK AVERSION POSTERIOR</div>
                <div style={{ fontSize: "28px", fontWeight: 700, color: "#0ea5e9", marginBottom: "6px" }}>γ {gamma.toFixed(2)}</div>
                <div style={{ fontSize: "13px", color: "#e2e8f0", fontWeight: 600, marginBottom: "4px" }}>{gammaProfile.title}</div>
                <div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.5, marginBottom: "8px" }}>{gammaProfile.desc}</div>
                <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "6px" }}>95% CI {posteriorStats.gammaLo95.toFixed(1)} to {posteriorStats.gammaHi95.toFixed(1)}</div>
                <DistributionStrip values={posteriorStats.gammaMarginal} color="#0ea5e9" />
              </div>

              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "12px", padding: "14px", textAlign: "left" }}>
                <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "6px" }}>PERCEIVED EDGE / CONFIDENCE</div>
                <div style={{ fontSize: "28px", fontWeight: 700, color: edge >= 0 ? "#f97316" : "#a78bfa", marginBottom: "6px" }}>{edge >= 0 ? "+" : ""}{edge.toFixed(2)}</div>
                <div style={{ fontSize: "13px", color: "#e2e8f0", fontWeight: 600, marginBottom: "4px" }}>{edgeProfile.title}</div>
                <div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.5, marginBottom: "8px" }}>{edgeProfile.desc}</div>
                <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "6px" }}>95% CI {posteriorStats.edgeLo95.toFixed(2)} to {posteriorStats.edgeHi95.toFixed(2)}</div>
                <DistributionStrip values={posteriorStats.edgeMarginal} color={edge >= 0 ? "#f97316" : "#a78bfa"} />
              </div>
            </div>

            <div style={{ width: "100%", maxWidth: "650px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "10px", padding: "12px" }}>
                <div style={{ fontSize: "11px", color: "#64748b" }}>Final skill</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#22c55e" }}>{skill.toFixed(2)}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "10px", padding: "12px" }}>
                <div style={{ fontSize: "11px", color: "#64748b" }}>Peak wealth</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#e2e8f0" }}>{fmt$(wealthPeak)}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "10px", padding: "12px" }}>
                <div style={{ fontSize: "11px", color: "#64748b" }}>Local market obs</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#e2e8f0" }}>{marketObs}</div>
              </div>
            </div>

            <div style={{ width: "100%", maxWidth: "650px", background: "rgba(255,255,255,0.03)", border: "1px solid #1e293b", borderRadius: "12px", padding: "14px", marginBottom: "18px" }}>
              <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "8px", textAlign: "left" }}>ROUND LOG</div>
              <div style={{ maxHeight: "190px", overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ color: "#64748b", textAlign: "left" }}>
                      <th style={{ padding: "6px 4px" }}>R</th>
                      <th style={{ padding: "6px 4px" }}>Mission</th>
                      <th style={{ padding: "6px 4px" }}>Stake</th>
                      <th style={{ padding: "6px 4px" }}>Outcome</th>
                      <th style={{ padding: "6px 4px" }}>P&amp;L</th>
                      <th style={{ padding: "6px 4px" }}>Wealth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roundHistory.map((r) => (
                      <tr key={r.round} style={{ borderTop: "1px solid #1e293b" }}>
                        <td style={{ padding: "6px 4px", color: "#94a3b8" }}>{r.round}</td>
                        <td style={{ padding: "6px 4px" }}>{r.target}</td>
                        <td style={{ padding: "6px 4px", color: "#fbbf24" }}>{fmt$(r.betAmount)}</td>
                        <td style={{ padding: "6px 4px", color: r.outcome === "success" ? "#4ade80" : r.outcome === "miss" ? "#fbbf24" : "#f87171" }}>{r.outcome}</td>
                        <td style={{ padding: "6px 4px", color: r.pnl >= 0 ? "#4ade80" : "#f87171" }}>{fmtSigned$(r.pnl)}</td>
                        <td style={{ padding: "6px 4px" }}>{fmt$(r.wealthAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button onClick={startGame} style={btnStyle("#0ea5e9")}>RUN AGAIN</button>
              <button onClick={resetLocalBook} style={btnStyle("#334155")}>RESET LOCAL BOOK</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
