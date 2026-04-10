import { clamp } from "@/lib/formatters";
import { CorrelatedMemecoinRow } from "@/types/view-models";

export type MemecoinMomentumSignal =
  | "Acceleration"
  | "Breakout starting"
  | "Volume confirmation"
  | "Early continuation"
  | "Buy pressure"
  | "Early strength";

export type MemecoinMomentumAssessment = {
  momentumScore: number;
  momentumSignal: MemecoinMomentumSignal;
};

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function linearScore(value: number | null | undefined, min: number, max: number) {
  if (!isFiniteNumber(value) || max <= min) {
    return 0;
  }

  return clamp01((value - min) / (max - min));
}

function logScore(value: number | null | undefined, min: number, max: number) {
  if (!isFiniteNumber(value) || value <= 0 || min <= 0 || max <= min) {
    return 0;
  }

  return clamp01((Math.log10(value) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)));
}

function averageScore(values: number[], fallback = 0) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) {
    return fallback;
  }

  return usable.reduce((total, value) => total + value, 0) / usable.length;
}

function ratioScore(
  current: number | null | undefined,
  baseline: number | null | undefined,
  neutralRatio: number,
  strongRatio: number,
  fallback = 0.35,
) {
  if (!isFiniteNumber(current) || current <= 0) {
    return 0;
  }

  if (!isFiniteNumber(baseline) || baseline <= 0 || strongRatio <= neutralRatio) {
    return fallback;
  }

  return clamp01((current / baseline - neutralRatio) / (strongRatio - neutralRatio));
}

function fdvSanityScore(row: CorrelatedMemecoinRow) {
  if (!isFiniteNumber(row.fdvUsd) || row.fdvUsd <= 0 || !isFiniteNumber(row.marketCapUsd) || row.marketCapUsd <= 0) {
    return 0.58;
  }

  const ratio = row.marketCapUsd / row.fdvUsd;
  if (ratio >= 0.55 && ratio <= 1.12) {
    return 1;
  }
  if (ratio >= 0.38 && ratio < 0.55) {
    return 0.82;
  }
  if (ratio >= 0.2 && ratio < 0.38) {
    return 0.48;
  }
  if (ratio > 1.12 && ratio <= 1.35) {
    return 0.74;
  }

  return 0.2;
}

function freshnessBonus(row: CorrelatedMemecoinRow) {
  const ageHours = row.pairAgeHours;
  if (!isFiniteNumber(ageHours) || ageHours < 0) {
    return 0.4;
  }
  if (ageHours < 1) {
    return 0.05;
  }
  if (ageHours < 4) {
    return 0.18;
  }
  if (ageHours < 12) {
    return 0.5;
  }
  if (ageHours < 72) {
    return 1;
  }
  if (ageHours < 24 * 14) {
    return 0.86;
  }
  if (ageHours < 24 * 45) {
    return 0.56;
  }
  if (ageHours < 24 * 90) {
    return 0.32;
  }

  return 0.12;
}

function shortTermPriceStrength(row: CorrelatedMemecoinRow) {
  const oneHourStrength = linearScore(row.priceChange1hPct, 0.5, 8.5);
  const sixHourSupport = linearScore(row.priceChange6hPct, 1.4, 18);
  const daySupport = linearScore(row.priceChange24hPct, 2, 38);

  let score = oneHourStrength * 0.56 + sixHourSupport * 0.31 + daySupport * 0.13;

  if (isFiniteNumber(row.priceChange1hPct) && row.priceChange1hPct < 0) {
    score *= 0.4;
  }
  if (isFiniteNumber(row.priceChange6hPct) && row.priceChange6hPct < 0) {
    score *= 0.6;
  }

  return clamp01(score);
}

function priceAccelerationScore(row: CorrelatedMemecoinRow) {
  const oneHour = row.priceChange1hPct;
  const sixHour = row.priceChange6hPct;
  const day = row.priceChange24hPct;
  const sixHourBaseline = isFiniteNumber(sixHour) ? Math.max(Math.abs(sixHour) / 6, 0.45) : null;
  const dayBaseline = isFiniteNumber(day) ? Math.max(Math.abs(day) / 24, 0.35) : null;

  const turnNow =
    isFiniteNumber(oneHour) && oneHour > 0
      ? isFiniteNumber(sixHour) && sixHour <= 0
        ? linearScore(oneHour, 0.5, 6)
        : ratioScore(oneHour, sixHourBaseline, 1.05, 3.2, 0.42)
      : 0;
  const sixHourTurn =
    isFiniteNumber(sixHour) && sixHour > 0
      ? isFiniteNumber(day) && day <= 0
        ? linearScore(sixHour, 1.5, 12)
        : ratioScore(sixHour / 6, dayBaseline, 1, 2.6, 0.4)
      : 0;

  return clamp01(averageScore([turnNow, sixHourTurn], 0.34));
}

function recentVolumeAcceleration(row: CorrelatedMemecoinRow) {
  return averageScore(
    [
      ratioScore(row.volume1hUsd, isFiniteNumber(row.volume24hUsd) ? row.volume24hUsd / 24 : null, 1.02, 4.4, 0.35),
      ratioScore(row.volume6hUsd, isFiniteNumber(row.volume24hUsd) ? row.volume24hUsd / 4 : null, 1, 2.8, 0.34),
    ],
    0.34,
  );
}

function recentTxnAcceleration(row: CorrelatedMemecoinRow) {
  return averageScore(
    [
      ratioScore(row.txns1h, isFiniteNumber(row.txns24h) ? row.txns24h / 24 : null, 1, 4, 0.34),
      ratioScore(row.txns6h, isFiniteNumber(row.txns24h) ? row.txns24h / 4 : null, 1, 2.7, 0.34),
    ],
    0.34,
  );
}

function accelerationFactor(row: CorrelatedMemecoinRow) {
  return clamp01(
    priceAccelerationScore(row) * 0.46 +
      recentVolumeAcceleration(row) * 0.33 +
      recentTxnAcceleration(row) * 0.21,
  );
}

function volumeConfirmation(row: CorrelatedMemecoinRow) {
  const absolutePresence = averageScore(
    [
      logScore(row.volume1hUsd, 10_000, 450_000),
      logScore(row.volume6hUsd, 45_000, 1_900_000),
      logScore(row.volume24hUsd, 120_000, 6_000_000),
    ],
    0.28,
  );
  const ratioPresence = averageScore(
    [recentVolumeAcceleration(row), ratioScore(row.volume24hUsd, row.liquidityUsd, 0.9, 7.5, 0.3)],
    0.32,
  );

  return clamp01(absolutePresence * 0.62 + ratioPresence * 0.38);
}

function transactionConfirmation(row: CorrelatedMemecoinRow) {
  const absolutePresence = averageScore(
    [
      logScore(row.txns1h, 18, 320),
      logScore(row.txns6h, 80, 1_250),
      logScore(row.txns24h, 220, 6_000),
    ],
    0.24,
  );

  return clamp01(absolutePresence * 0.6 + recentTxnAcceleration(row) * 0.4);
}

function buyPressure(row: CorrelatedMemecoinRow) {
  const buys = Math.max(0, row.buys24h ?? 0);
  const sells = Math.max(0, row.sells24h ?? 0);
  const total = buys + sells;
  if (total <= 0) {
    return row.communityTakeover ? 0.55 : 0.5;
  }

  const participationBlend = clamp01(total / 400);
  const rawScore = clamp01((buys / total - 0.48) / 0.18);
  return clamp01(rawScore * (0.65 + participationBlend * 0.35));
}

function liquidityQuality(row: CorrelatedMemecoinRow) {
  const pairIntegrity = row.dexscreenerUrl && row.pairAddress && row.quoteSymbol ? 1 : 0.2;
  const liquidityScore = logScore(row.liquidityUsd, 40_000, 2_500_000);
  const marketScore = linearScore(row.marketScore, 54, 86);
  const ratioScoreValue = ratioScore(row.volume24hUsd, row.liquidityUsd, 0.8, 6.5, 0.36);

  return clamp01(
    liquidityScore * 0.42 +
      marketScore * 0.22 +
      ratioScoreValue * 0.16 +
      fdvSanityScore(row) * 0.12 +
      pairIntegrity * 0.08,
  );
}

function overextensionPenalty(row: CorrelatedMemecoinRow) {
  let penalty = 0;
  const dayMove = row.priceChange24hPct ?? null;
  const oneHourMove = row.priceChange1hPct ?? null;
  const sixHourMove = row.priceChange6hPct ?? null;
  const volumeFade = ratioScore(row.volume1hUsd, isFiniteNumber(row.volume24hUsd) ? row.volume24hUsd / 24 : null, 0.9, 2, 0.28);

  if (isFiniteNumber(dayMove) && dayMove >= 45) {
    penalty += linearScore(dayMove, 45, 180) * 10;
    if (!isFiniteNumber(oneHourMove) || oneHourMove <= 0.8) {
      penalty += linearScore(dayMove, 45, 180) * 9;
    }
    if (!isFiniteNumber(sixHourMove) || sixHourMove <= 2) {
      penalty += 4.5;
    }
    if (volumeFade < 0.26) {
      penalty += 3.5;
    }
  }

  if (
    isFiniteNumber(dayMove) &&
    isFiniteNumber(oneHourMove) &&
    isFiniteNumber(sixHourMove) &&
    dayMove >= 35 &&
    oneHourMove < Math.max(0.35, sixHourMove / 6 * 0.35)
  ) {
    penalty += 4.5;
  }

  if (isFiniteNumber(dayMove) && dayMove >= 90 && isFiniteNumber(oneHourMove) && oneHourMove < 0) {
    penalty += 7;
  }

  return clamp(penalty, 0, 28);
}

function rugRiskPenalty(row: CorrelatedMemecoinRow) {
  let penalty = 0;

  if (!row.dexscreenerUrl || !row.pairAddress || !row.quoteSymbol) {
    penalty += 18;
  }

  if (!isFiniteNumber(row.liquidityUsd) || row.liquidityUsd < 25_000) {
    penalty += 22;
  } else if (row.liquidityUsd < 50_000) {
    penalty += 14;
  } else if (row.liquidityUsd < 80_000) {
    penalty += 7;
  }

  if (!isFiniteNumber(row.volume24hUsd) || row.volume24hUsd < 60_000) {
    penalty += 16;
  } else if (row.volume24hUsd < 120_000) {
    penalty += 8;
  }

  if (isFiniteNumber(row.txns24h) && row.txns24h < 80) {
    penalty += 8;
  } else if (isFiniteNumber(row.txns24h) && row.txns24h < 160) {
    penalty += 4;
  }

  if (isFiniteNumber(row.priceUsd) && row.priceUsd <= 0) {
    penalty += 30;
  }

  if (
    isFiniteNumber(row.volume24hUsd) &&
    isFiniteNumber(row.liquidityUsd) &&
    row.liquidityUsd > 0 &&
    row.volume24hUsd / row.liquidityUsd > 18
  ) {
    penalty += 6;
  }

  if (fdvSanityScore(row) < 0.25) {
    penalty += 8;
  }

  if (
    (row.websites?.length ?? 0) === 0 &&
    (row.socials?.length ?? 0) === 0 &&
    (!isFiniteNumber(row.marketScore) || row.marketScore < 60)
  ) {
    penalty += 3;
  }

  if (isFiniteNumber(row.pairAgeHours) && row.pairAgeHours < 1) {
    penalty += 8;
  }

  return clamp(penalty, 0, 38);
}

function stagnationPenalty(row: CorrelatedMemecoinRow) {
  const ageHours = row.pairAgeHours;
  if (!isFiniteNumber(ageHours) || ageHours < 0) {
    return 0;
  }

  let penalty = 0;
  const oneHourMove = row.priceChange1hPct ?? null;
  const sixHourMove = row.priceChange6hPct ?? null;
  const volumeKick = recentVolumeAcceleration(row);
  const txnKick = recentTxnAcceleration(row);

  if (ageHours >= 24 * 14) {
    if (!isFiniteNumber(oneHourMove) || oneHourMove < 0.6) {
      penalty += 4;
    }
    if (!isFiniteNumber(sixHourMove) || sixHourMove < 2) {
      penalty += 4;
    }
    if (volumeKick < 0.34) {
      penalty += 3.5;
    }
    if (txnKick < 0.34) {
      penalty += 3.5;
    }
  }

  if (ageHours >= 24 * 45) {
    penalty += 2;
  }

  return clamp(penalty, 0, 18);
}

function resolveMomentumSignal(row: CorrelatedMemecoinRow, assessment: Omit<MemecoinMomentumAssessment, "momentumSignal">) {
  const priceStrength = shortTermPriceStrength(row);
  const acceleration = accelerationFactor(row);
  const volume = volumeConfirmation(row);
  const txns = transactionConfirmation(row);
  const orderFlow = buyPressure(row);
  const overextended = overextensionPenalty(row);

  if (acceleration >= 0.74 && volume >= 0.62 && txns >= 0.56 && overextended <= 8) {
    return "Breakout starting" satisfies MemecoinMomentumSignal;
  }
  if (acceleration >= 0.76) {
    return "Acceleration" satisfies MemecoinMomentumSignal;
  }
  if (volume >= 0.72 && txns >= 0.6) {
    return "Volume confirmation" satisfies MemecoinMomentumSignal;
  }
  if (priceStrength >= 0.68 && overextended <= 10) {
    return "Early continuation" satisfies MemecoinMomentumSignal;
  }
  if (orderFlow >= 0.66 && assessment.momentumScore >= 55) {
    return "Buy pressure" satisfies MemecoinMomentumSignal;
  }

  return "Early strength" satisfies MemecoinMomentumSignal;
}

export function assessMemecoinMomentum(row: CorrelatedMemecoinRow): MemecoinMomentumAssessment {
  const positiveScore =
    100 *
    (
      shortTermPriceStrength(row) * 0.24 +
      accelerationFactor(row) * 0.19 +
      volumeConfirmation(row) * 0.17 +
      transactionConfirmation(row) * 0.13 +
      buyPressure(row) * 0.09 +
      liquidityQuality(row) * 0.11 +
      freshnessBonus(row) * 0.07
    );

  const penalty =
    overextensionPenalty(row) * 0.95 +
    rugRiskPenalty(row) * 1 +
    stagnationPenalty(row) * 0.9;
  const momentumScore = Math.round(clamp(positiveScore - penalty, 0, 100));

  return {
    momentumScore,
    momentumSignal: resolveMomentumSignal(row, { momentumScore }),
  };
}

export function compareCorrelatedMemecoinsByMomentum(
  left: Pick<
    CorrelatedMemecoinRow,
    | "momentumScore"
    | "priceChange1hPct"
    | "volume1hUsd"
    | "txns1h"
    | "liquidityUsd"
    | "rank"
  >,
  right: Pick<
    CorrelatedMemecoinRow,
    | "momentumScore"
    | "priceChange1hPct"
    | "volume1hUsd"
    | "txns1h"
    | "liquidityUsd"
    | "rank"
  >,
) {
  const momentumDelta = Number(right.momentumScore ?? 0) - Number(left.momentumScore ?? 0);
  if (momentumDelta !== 0) {
    return momentumDelta;
  }

  const oneHourDelta = Number(right.priceChange1hPct ?? 0) - Number(left.priceChange1hPct ?? 0);
  if (oneHourDelta !== 0) {
    return oneHourDelta;
  }

  const volumeDelta = Number(right.volume1hUsd ?? 0) - Number(left.volume1hUsd ?? 0);
  if (volumeDelta !== 0) {
    return volumeDelta;
  }

  const txnDelta = Number(right.txns1h ?? 0) - Number(left.txns1h ?? 0);
  if (txnDelta !== 0) {
    return txnDelta;
  }

  const liquidityDelta = Number(right.liquidityUsd ?? 0) - Number(left.liquidityUsd ?? 0);
  if (liquidityDelta !== 0) {
    return liquidityDelta;
  }

  return Number(left.rank ?? 0) - Number(right.rank ?? 0);
}
