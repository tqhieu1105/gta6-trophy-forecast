import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Trophy = { id: number; name: string; description: string; tier: string };
type Read = { at: string; players_tracked: number; trophies_earned: number; rates: Array<number | null> };
type ForecastCase = {
  id: string;
  at: string;
  target: string;
  levels: number[];
  horizon_minutes: number;
  game: { release_date: string };
  trophies: Trophy[];
  history: Read[];
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const levels = [0.05, 0.25, 0.5, 0.75, 0.95];
const normalScores = [-1.645, -0.674, 0, 0.674, 1.645];
const lowerPct = 0.01;
const upperPct = 99.99;

const cap = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const logit = (percent: number): number => {
  const p = cap(percent, lowerPct, upperPct) / 100;
  return Math.log(p / (1 - p));
};
const logisticPercent = (value: number): number => 100 / (1 + Math.exp(-cap(value, -30, 30)));
const ageHours = (time: string, release: string): number => Math.max(0, (Date.parse(time) - Date.parse(`${release}T00:00:00Z`)) / 3_600_000);
const ageAxis = (hours: number): number => Math.log1p(Math.max(0, hours) / 12);

function robustExponent(points: Array<[number, number]>): number {
  if (points.length < 2) return 0;
  const slopes: number[] = [];
  for (let left = 0; left < points.length; left++) {
    for (let right = left + 1; right < points.length; right++) {
      const dx = points[right][0] - points[left][0];
      if (dx > 0.002) slopes.push((points[right][1] - points[left][1]) / dx);
    }
  }
  return cap(median(slopes), -0.1, 2.2);
}

function distinctReads(reads: Read[]): Read[] {
  const kept: Read[] = [];
  let prior = '';
  for (const read of reads) {
    if (!Number.isFinite(read.players_tracked) || read.players_tracked < 1) continue;
    const signature = `${read.players_tracked}|${read.rates.map((rate) => rate ?? 'x').join(',')}`;
    if (signature !== prior) kept.push(read);
    prior = signature;
  }
  return kept;
}

function project(caseData: ForecastCase, trophyIndex: number, reads: Read[]): { median: number; spread: number; downside: number } {
  const targetHours = ageHours(caseData.target, caseData.game.release_date);
  const targetAxis = ageAxis(targetHours);
  const historyPoints = reads.map((read) => ({
    read,
    hours: ageHours(read.at, caseData.game.release_date),
    axis: ageAxis(ageHours(read.at, caseData.game.release_date)),
  }));
  const lastPoint = historyPoints[historyPoints.length - 1];
  const lastRate = cap(lastPoint.read.rates[trophyIndex] ?? lowerPct, 0, 100);
  const lastPlayers = lastPoint.read.players_tracked;
  const futureAxisGap = Math.max(0, targetAxis - lastPoint.axis);

  const populationPoints = historyPoints
    .filter((point) => point.read.players_tracked > 0)
    .slice(-12)
    .map((point) => [point.axis, Math.log(point.read.players_tracked)] as [number, number]);
  const populationConfidence = cap((populationPoints.length - 2) / 7, 0, 0.86);
  const observedPopulationSlope = robustExponent(populationPoints);
  const populationSlope = populationConfidence * observedPopulationSlope + (1 - populationConfidence) * 0.58;

  const earns: Array<[number, number]> = [];
  let cumulativeFloor = 0;
  for (const point of historyPoints) {
    const observedRate = point.read.rates[trophyIndex];
    if (observedRate === null || !Number.isFinite(observedRate)) continue;
    const estimate = Math.max(0.5, point.read.players_tracked * cap(observedRate, 0, 100) / 100);
    cumulativeFloor = Math.max(cumulativeFloor, estimate);
    earns.push([point.axis, Math.log(cumulativeFloor)]);
  }
  const recentEarns = earns.slice(-12);
  const earnConfidence = cap((recentEarns.length - 2) / 7, 0, 0.82);
  const observedEarnSlope = robustExponent(recentEarns);
  const desc = `${caseData.trophies[trophyIndex].name} ${caseData.trophies[trophyIndex].description}`.toLowerCase();
  const narrative = /chapter|story|final mission|complete .*mission|ending/.test(desc);
  const rateFactor = lastRate >= 95 && earns.length < 3 ? 0.38 : lastRate >= 80 && earns.length < 3 ? 0.62 : 1;
  const priorEarnSlope = narrative ? populationSlope + 0.22 : populationSlope * (lastRate < 35 ? 0.78 : 0.5);
  const earnSlope = cap((earnConfidence * observedEarnSlope + (1 - earnConfidence) * priorEarnSlope) * rateFactor, -0.05, 2.1);

  const latestEarners = earns.length ? Math.exp(earns[earns.length - 1][1]) : Math.max(0.5, lastPlayers * lastRate / 100);
  const horizonDamping = 0.74 / (1 + 0.08 * futureAxisGap);
  const projectedPlayers = lastPlayers * Math.exp(populationSlope * futureAxisGap * horizonDamping);
  const projectedEarners = latestEarners * Math.exp(earnSlope * futureAxisGap * horizonDamping);
  const rawCentral = reads.length === 1 ? lastRate : cap(100 * projectedEarners / Math.max(projectedPlayers, 1), 0, 100);
  const targetStaleHours = Math.max(0, (Date.parse(caseData.target) - Date.parse(lastPoint.read.at)) / 3_600_000);
  const firstRefreshRisk = reads.length === 1 && lastPlayers < 2_000 && targetStaleHours > 4.25 && lastRate < 99.99
    ? Math.sqrt(targetStaleHours - 4.25)
    : 0;
  const launchDilution = firstRefreshRisk ? 0.55 * cap((targetStaleHours - 4.25) / 0.75, 0, 1) : 0;
  const central = launchDilution ? logisticPercent(logit(rawCentral) - launchDilution) : rawCentral;

  const recentRates = historyPoints.slice(-8).map((point) => point.read.rates[trophyIndex]).filter((rate): rate is number => rate !== null && Number.isFinite(rate));
  const logitSteps: number[] = [];
  for (let i = 1; i < recentRates.length; i++) logitSteps.push(logit(recentRates[i]) - logit(recentRates[i - 1]));
  const movement = median(logitSteps.map(Math.abs));
  const elapsedDays = caseData.horizon_minutes / 1440;
  const spread = cap(Math.sqrt((0.50 * Math.sqrt(elapsedDays)) ** 2 + movement ** 2), 0.06, 1.85);
  return { median: central, spread, downside: firstRefreshRisk * 1.2 };
}

function runOne(caseData: ForecastCase): { trophies: Array<{ id: number; q: number[] }> } {
  if (caseData.levels.length !== levels.length || caseData.levels.some((level, i) => level !== levels[i])) {
    throw new Error(`${caseData.id}: unsupported quantile levels`);
  }
  if (!caseData.history.length) throw new Error(`${caseData.id}: no historical reads`);
  const reads = distinctReads(caseData.history);
  if (!reads.length) throw new Error(`${caseData.id}: no usable reads`);
  return {
    trophies: caseData.trophies.map((trophy, index) => {
      const estimate = project(caseData, index, reads);
      const center = logit(estimate.median);
      const q = normalScores.map((z, i) => {
        const lowerTail = i < 2 ? estimate.downside : 0;
        return Math.round(cap(logisticPercent(center + z * estimate.spread - lowerTail), 0, 100) * 10_000) / 10_000;
      });
      return { id: trophy.id, q };
    }),
  };
}

mkdirSync(outputDir, { recursive: true });
for (const file of readdirSync(inputDir).filter((name) => name.endsWith('.in')).sort()) {
  const data = JSON.parse(readFileSync(join(inputDir, file), 'utf8')) as ForecastCase;
  writeFileSync(join(outputDir, `${data.id}.out`), `${JSON.stringify(runOne(data))}\n`);
}
