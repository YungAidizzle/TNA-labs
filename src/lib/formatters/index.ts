export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

export function formatPreciseNumber(value: number, digits = 1) {
  const normalizedDigits = Number.isInteger(value) ? 0 : digits;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: normalizedDigits,
  }).format(value);
}

export function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

export function formatCurrency(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

export function formatSigned(value: number, digits = 1) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
}

export function formatSignedPercent(value: number, digits = 1) {
  return `${formatSigned(value, digits)}%`;
}

export function formatVelocityPerHour(value: number) {
  return `${formatCompactNumber(value)}/hr`;
}

export function formatAgeMinutes(ageMinutes: number) {
  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`;
  }

  const hours = Math.floor(ageMinutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTimeOnly(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function relativeLabel(value: string) {
  const deltaMs = new Date(value).getTime() - Date.now();
  const minutes = Math.round(deltaMs / 60_000);
  if (Math.abs(minutes) < 60) {
    return `${Math.abs(minutes)}m ${minutes <= 0 ? "ago" : "ahead"}`;
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return `${Math.abs(hours)}h ${hours <= 0 ? "ago" : "ahead"}`;
  }

  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ${days <= 0 ? "ago" : "ahead"}`;
}

export function formatRelativeTimeShort(
  value: string | null | undefined,
  referenceValue?: string | Date | null,
) {
  if (!value) {
    return "--";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "--";
  }

  const referenceTimestamp =
    referenceValue instanceof Date
      ? referenceValue.getTime()
      : typeof referenceValue === "string"
        ? Date.parse(referenceValue)
        : Date.now();

  const safeReference = Number.isFinite(referenceTimestamp) ? referenceTimestamp : Date.now();
  const deltaMinutes = Math.max(0, Math.round((safeReference - timestamp) / 60_000));

  if (deltaMinutes < 60) {
    return `${Math.max(1, deltaMinutes)}m`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d`;
}

export function formatHoursShort(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "--";
  }

  if (value < 1) {
    return `${Math.max(1, Math.round(value * 60))}m`;
  }

  if (value < 24) {
    return `${Math.max(1, Math.round(value))}h`;
  }

  const days = Math.round(value / 24);
  if (days < 30) {
    return `${days}d`;
  }

  return `${Math.round(days / 30)}mo`;
}
