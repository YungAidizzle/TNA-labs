import {
  BlueskyInteraction,
  BlueskyNormalizedPost,
  BlueskyPostSnapshot,
} from "@/lib/reddit/types";
import { TimeSeriesPoint } from "@/types/domain";
import {
  BlueskyFirehoseCluster,
  BlueskyFirehoseLeader,
  BlueskyFirehoseOverview,
  FirehoseNetworkEdge,
  FirehoseNetworkNode,
  RankedTrend,
  TrendBlueskyAmplifier,
  TrendBlueskyCascade,
} from "@/types/view-models";
import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function normalizePct(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return round1((value / total) * 100);
}

function getRootIdFromPost(post: BlueskyNormalizedPost) {
  return post.rootUri ?? post.id;
}

function getRootIdFromInteraction(interaction: BlueskyInteraction) {
  return interaction.rootUri ?? interaction.postUri;
}

function sumVelocity(summary: RankedTrend["blueskySummary"] | null | undefined) {
  if (!summary) {
    return 0;
  }
  return (
    (summary.repostVelocity ?? 0) +
    (summary.replyVelocity ?? 0) +
    (summary.quoteVelocity ?? 0) +
    (summary.likeVelocity ?? 0)
  );
}

function getBlueskyShare(trend: RankedTrend) {
  const fromSummary = trend.blueskySummary?.attentionSharePct;
  if (typeof fromSummary === "number" && Number.isFinite(fromSummary)) {
    return fromSummary;
  }
  return trend.platformBreakdown.find((item) => item.platformId === "bluesky")?.sharePct ?? 0;
}

function getUniqueCount(values: Array<string | null | undefined>) {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

export function buildBlueskyCascadeLeaders(params: {
  posts: BlueskyNormalizedPost[];
  interactions: BlueskyInteraction[];
  windowHours: number;
}): TrendBlueskyCascade[] {
  const { posts, interactions, windowHours } = params;
  const rootPostById = new Map<string, BlueskyNormalizedPost>();
  posts.forEach((post) => {
    const rootId = getRootIdFromPost(post);
    const existing = rootPostById.get(rootId);
    if (!existing || existing.createdUtc > post.createdUtc) {
      rootPostById.set(rootId, post.postType === "root" ? post : existing ?? post);
    }
  });

  const cascades = new Map<
    string,
    {
      rootId: string;
      title: string;
      authorHandle: string | null;
      interactions: number;
      uniqueParticipants: Set<string>;
      firstSeenUtc: number;
      lastSeenUtc: number;
    }
  >();

  posts.forEach((post) => {
    const rootId = getRootIdFromPost(post);
    const current = cascades.get(rootId) ?? {
      rootId,
      title: post.title ?? post.summary ?? "Bluesky post",
      authorHandle: post.authorHandle ?? null,
      interactions: 0,
      uniqueParticipants: new Set<string>(),
      firstSeenUtc: post.createdUtc,
      lastSeenUtc: post.createdUtc,
    };
    current.title = current.title || post.title || post.summary || "Bluesky post";
    current.authorHandle = current.authorHandle ?? post.authorHandle ?? null;
    current.interactions += 1;
    current.uniqueParticipants.add(post.authorDid);
    current.firstSeenUtc = Math.min(current.firstSeenUtc, post.createdUtc);
    current.lastSeenUtc = Math.max(current.lastSeenUtc, post.createdUtc);
    cascades.set(rootId, current);
  });

  interactions.forEach((interaction) => {
    const rootId = getRootIdFromInteraction(interaction);
    const current = cascades.get(rootId) ?? {
      rootId,
      title: rootPostById.get(rootId)?.title ?? rootPostById.get(rootId)?.summary ?? "Bluesky cascade",
      authorHandle: rootPostById.get(rootId)?.authorHandle ?? null,
      interactions: 0,
      uniqueParticipants: new Set<string>(),
      firstSeenUtc: interaction.createdUtc,
      lastSeenUtc: interaction.createdUtc,
    };
    current.interactions +=
      interaction.interactionType === "quote"
        ? 4
        : interaction.interactionType === "reply"
          ? 3
          : interaction.interactionType === "repost"
            ? 2
            : 1;
    current.uniqueParticipants.add(
      interaction.actorDid ?? interaction.actorHandle ?? interaction.id,
    );
    current.firstSeenUtc = Math.min(current.firstSeenUtc, interaction.createdUtc);
    current.lastSeenUtc = Math.max(current.lastSeenUtc, interaction.createdUtc);
    cascades.set(rootId, current);
  });

  const totalInteractions =
    [...cascades.values()].reduce((sum, cascade) => sum + cascade.interactions, 0) || 1;

  return [...cascades.values()]
    .sort((left, right) => {
      if (right.interactions !== left.interactions) {
        return right.interactions - left.interactions;
      }
      return right.uniqueParticipants.size - left.uniqueParticipants.size;
    })
    .slice(0, 6)
    .map((cascade) => ({
      rootDocumentId: cascade.rootId,
      title: cascade.title,
      authorHandle: cascade.authorHandle,
      interactions: cascade.interactions,
      velocity: round1(cascade.interactions / Math.max(windowHours, 0.25)),
      sharePct: normalizePct(cascade.interactions, totalInteractions),
      uniqueParticipants: cascade.uniqueParticipants.size,
    }));
}

export function buildBlueskyAmplifiers(params: {
  interactions: BlueskyInteraction[];
  posts?: BlueskyNormalizedPost[];
}): TrendBlueskyAmplifier[] {
  const { interactions, posts = [] } = params;
  const amplifiers = new Map<
    string,
    {
      did: string | null;
      handle: string;
      displayName: string | null;
      followersCount: number | null;
      interactions: number;
      documents: number;
    }
  >();

  interactions.forEach((interaction) => {
    const key =
      interaction.actorDid ?? interaction.actorHandle ?? `${interaction.interactionType}:${interaction.id}`;
    const current = amplifiers.get(key) ?? {
      did: interaction.actorDid ?? null,
      handle: interaction.actorHandle ?? interaction.actorDid ?? "unknown",
      displayName: interaction.actorDisplayName ?? null,
      followersCount: interaction.actorFollowersCount ?? null,
      interactions: 0,
      documents: 0,
    };
    current.interactions +=
      interaction.interactionType === "quote"
        ? 5
        : interaction.interactionType === "reply"
          ? 4
          : interaction.interactionType === "repost"
            ? 3
            : 1;
    current.documents += 1;
    amplifiers.set(key, current);
  });

  posts
    .filter((post) => post.postType === "quote" || post.postType === "reply")
    .forEach((post) => {
      const key = post.authorDid ?? post.authorHandle ?? post.id;
      const current = amplifiers.get(key) ?? {
        did: post.authorDid ?? null,
        handle: post.authorHandle ?? post.authorDid ?? "unknown",
        displayName: post.authorDisplayName ?? null,
        followersCount: post.authorFollowersCount ?? null,
        interactions: 0,
        documents: 0,
      };
      current.interactions += post.postType === "quote" ? 5 : 4;
      current.documents += 1;
      amplifiers.set(key, current);
    });

  const totalInteractions =
    [...amplifiers.values()].reduce((sum, amplifier) => sum + amplifier.interactions, 0) || 1;

  return [...amplifiers.values()]
    .sort((left, right) => {
      if (right.interactions !== left.interactions) {
        return right.interactions - left.interactions;
      }
      return right.documents - left.documents;
    })
    .slice(0, 8)
    .map((amplifier) => ({
      ...amplifier,
      contributionPct: normalizePct(amplifier.interactions, totalInteractions),
    }));
}

export function buildBlueskyPropagationNetwork(params: {
  interactions: BlueskyInteraction[];
  cascades: TrendBlueskyCascade[];
  amplifiers: TrendBlueskyAmplifier[];
}): { nodes: FirehoseNetworkNode[]; edges: FirehoseNetworkEdge[] } {
  const { interactions, cascades, amplifiers } = params;
  const topCascadeIds = new Set(cascades.map((cascade) => cascade.rootDocumentId));
  const topAmplifierHandles = new Set(amplifiers.map((amplifier) => amplifier.handle));

  const cascadeNodes: FirehoseNetworkNode[] = cascades.map((cascade, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(cascades.length, 1);
    return {
      id: cascade.rootDocumentId,
      label: cascade.title,
      x: Math.cos(angle) * 55,
      y: Math.sin(angle) * 55,
      size: 10 + cascade.sharePct * 0.18,
      color: [94, 231, 255],
    };
  });
  const amplifierNodes: FirehoseNetworkNode[] = amplifiers.map((amplifier, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(amplifiers.length, 1);
    return {
      id: amplifier.handle,
      label: amplifier.displayName ? `${amplifier.displayName} @${amplifier.handle}` : `@${amplifier.handle}`,
      x: Math.cos(angle) * 135,
      y: Math.sin(angle) * 135,
      size: 8 + amplifier.contributionPct * 0.22,
      color: [255, 190, 100],
    };
  });

  const cascadeNodeById = new Map(cascadeNodes.map((node) => [node.id, node] as const));
  const amplifierNodeById = new Map(amplifierNodes.map((node) => [node.id, node] as const));
  const edgeWeights = new Map<string, number>();

  interactions.forEach((interaction) => {
    const rootId = getRootIdFromInteraction(interaction);
    const actorHandle = interaction.actorHandle ?? interaction.actorDid ?? "";
    if (!topCascadeIds.has(rootId) || !topAmplifierHandles.has(actorHandle)) {
      return;
    }
    const key = `${actorHandle}->${rootId}`;
    const weight =
      interaction.interactionType === "quote"
        ? 4
        : interaction.interactionType === "reply"
          ? 3
          : interaction.interactionType === "repost"
            ? 2
            : 1;
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + weight);
  });

  const edges = [...edgeWeights.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 18)
    .map(([key, weight]) => {
      const [actorHandle, rootId] = key.split("->");
      const source = amplifierNodeById.get(actorHandle);
      const target = cascadeNodeById.get(rootId);
      if (!source || !target) {
        return null;
      }
      return {
        source: [source.x, source.y] as [number, number],
        target: [target.x, target.y] as [number, number],
        width: Math.max(1, weight * 0.6),
        color: [126, 166, 255] as [number, number, number],
      };
    })
    .filter((edge): edge is FirehoseNetworkEdge => edge !== null);

  return {
    nodes: [...cascadeNodes, ...amplifierNodes],
    edges,
  };
}

export function buildBlueskyReplaySeries(params: {
  posts: BlueskyNormalizedPost[];
  interactions: BlueskyInteraction[];
  referenceTime: Date;
  windowMs: number;
  bucketCount: number;
}): TimeSeriesPoint[] {
  const { posts, interactions, referenceTime, windowMs, bucketCount } = params;
  const endMs = referenceTime.getTime();
  const startMs = endMs - windowMs;
  const bucketMs = windowMs / Math.max(bucketCount, 1);
  const points = Array.from({ length: bucketCount }, (_, index) => ({
    timestamp: new Date(Math.min(endMs, startMs + bucketMs * (index + 1))).toISOString(),
    value: 0,
  }));

  const applyPoint = (createdUtc: number, weight: number) => {
    const createdMs = createdUtc * 1000;
    if (createdMs < startMs || createdMs > endMs) {
      return;
    }
    const index = Math.min(
      points.length - 1,
      Math.max(0, Math.floor((createdMs - startMs) / bucketMs)),
    );
    points[index].value = round1(points[index].value + weight);
  };

  posts.forEach((post) => applyPoint(post.createdUtc, post.postType === "root" ? 4 : 3));
  interactions.forEach((interaction) =>
    applyPoint(
      interaction.createdUtc,
      interaction.interactionType === "quote"
        ? 4
        : interaction.interactionType === "reply"
          ? 3
          : interaction.interactionType === "repost"
            ? 2
            : 1,
    ),
  );

  return points;
}

export function buildBlueskyFirehoseOverview(params: {
  ranked: RankedTrend[];
  posts: BlueskyNormalizedPost[];
  interactions: BlueskyInteraction[];
  snapshots: BlueskyPostSnapshot[];
  referenceTime: Date;
  windowMs: number;
  generatedAt: string | null;
}): BlueskyFirehoseOverview | null {
  const { ranked, posts, interactions, snapshots, referenceTime, windowMs, generatedAt } = params;
  const blueskyRanked = ranked.filter(
    (trend) =>
      (trend.blueskySummary && getBlueskyShare(trend) > 0) ||
      trend.platformBreakdown.some((item) => item.platformId === "bluesky"),
  );
  if (blueskyRanked.length === 0 && posts.length === 0 && interactions.length === 0) {
    return null;
  }

  const totalTrendInteractions =
    ranked.reduce((sum, trend) => sum + trend.attentionInteractions, 0) || 1;
  const blueskyTrendInteractions = blueskyRanked.reduce(
    (sum, trend) => sum + trend.attentionInteractions * (getBlueskyShare(trend) / 100),
    0,
  );
  const attentionSharePct = normalizePct(blueskyTrendInteractions, totalTrendInteractions);
  const windowMinutes = Math.max(windowMs / 60_000, 5);
  const windowHours = Math.max(windowMs / (60 * 60 * 1000), 0.25);
  const likesPerMinute = round1(
    interactions.filter((interaction) => interaction.interactionType === "like").length / windowMinutes,
  );
  const repostsPerMinute = round1(
    interactions.filter((interaction) => interaction.interactionType === "repost").length / windowMinutes,
  );
  const repliesPerMinute = round1(
    interactions.filter((interaction) => interaction.interactionType === "reply").length / windowMinutes,
  );
  const quotesPerMinute = round1(
    interactions.filter((interaction) => interaction.interactionType === "quote").length / windowMinutes,
  );
  const postsPerMinute = round1(posts.length / windowMinutes);
  const accountSpread = getUniqueCount([
    ...posts.map((post) => post.authorDid),
    ...interactions.map((interaction) => interaction.actorDid ?? interaction.actorHandle ?? null),
  ]);

  const cascades = buildBlueskyCascadeLeaders({
    posts,
    interactions,
    windowHours,
  });
  const topAmplifiers = buildBlueskyAmplifiers({ interactions, posts });
  const network = buildBlueskyPropagationNetwork({
    interactions,
    cascades,
    amplifiers: topAmplifiers.slice(0, 6),
  });
  const noiseInteractions = cascades
    .filter((cascade) => cascade.uniqueParticipants < 3 && cascade.interactions < 10)
    .reduce((sum, cascade) => sum + cascade.interactions, 0);
  const totalCascadeInteractions = cascades.reduce((sum, cascade) => sum + cascade.interactions, 0) || 1;
  const noiseRatioPct = normalizePct(noiseInteractions, totalCascadeInteractions);
  const engagementIntensity = round1(
    posts.length * 4 +
      likesPerMinute * 2 +
      repostsPerMinute * 16 +
      repliesPerMinute * 18 +
      quotesPerMinute * 20,
  );
  const meaningfulAttentionScore = round1(
    engagementIntensity *
      Math.max(1, Math.log2(accountSpread + 1)) *
      Math.max(0.25, 1 - noiseRatioPct / 100),
  );
  const replay = buildBlueskyReplaySeries({
    posts,
    interactions,
    referenceTime,
    windowMs,
    bucketCount: 24,
  });
  const replayRecent = replay.slice(Math.max(0, replay.length - 6)).reduce((sum, point) => sum + point.value, 0);
  const replayPrior = replay.slice(Math.max(0, replay.length - 12), Math.max(0, replay.length - 6)).reduce((sum, point) => sum + point.value, 0);
  const accelerationScore =
    replayPrior > 0 ? round1(((replayRecent - replayPrior) / replayPrior) * 100) : replayRecent > 0 ? 100 : 0;
  const firehoseLagMinutes =
    snapshots
      .map((snapshot) => snapshot.fetchedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1)
      ? Math.max(
          0,
          Math.round(
            (referenceTime.getTime() -
              Date.parse(
                snapshots
                  .map((snapshot) => snapshot.fetchedAt)
                  .filter((value): value is string => Boolean(value))
                  .sort()
                  .at(-1)!,
              )) /
              60_000,
          ),
        )
      : null;

  const toLeader = (trend: RankedTrend): BlueskyFirehoseLeader => ({
    id: trend.id,
    label: getTrendDisplayNameOrPlaceholder(trend),
    trendId: trend.id,
    attentionScore: round1(trend.attentionInteractions * Math.max(0.2, getBlueskyShare(trend) / 100)),
    velocity: round1(sumVelocity(trend.blueskySummary) || Math.max(0, trend.growthRate)),
    accelerationScore: round1(
      trend.blueskySummary?.accelerationScore ?? trend.attentionAcceleration,
    ),
    attentionSharePct: round1(getBlueskyShare(trend)),
    uniqueAuthors:
      trend.blueskySummary?.accountSpread ??
      trend.blueskySummary?.uniqueAuthorCount ??
      0,
    amplificationScore:
      trend.blueskySummary?.amplificationScore ??
      trend.blueskySummary?.amplifierCount ??
      0,
    topAmplifierHandle:
      trend.blueskySummary?.topAmplifier ??
      trend.blueskySummary?.topAmplifierHandle ??
      null,
  });

  const leaders = [...blueskyRanked]
    .sort((left, right) => toLeader(right).attentionScore - toLeader(left).attentionScore)
    .slice(0, 5)
    .map(toLeader);

  const emerging = [...blueskyRanked]
    .sort((left, right) => toLeader(right).accelerationScore - toLeader(left).accelerationScore)
    .slice(0, 5)
    .map(toLeader);

  const clusterMap = new Map<string, BlueskyFirehoseCluster>();
  blueskyRanked.forEach((trend) => {
    const key = trend.clusterId || trend.name;
    const current = clusterMap.get(key) ?? {
      id: key,
      label: getTrendDisplayNameOrPlaceholder(trend),
      narratives: 0,
      attentionScore: 0,
      velocity: 0,
      uniqueAuthors: 0,
      sharePct: 0,
    };
    current.narratives += 1;
    current.attentionScore += toLeader(trend).attentionScore;
    current.velocity += toLeader(trend).velocity;
    current.uniqueAuthors += toLeader(trend).uniqueAuthors;
    clusterMap.set(key, current);
  });
  const clusterTotal =
    [...clusterMap.values()].reduce((sum, cluster) => sum + cluster.attentionScore, 0) || 1;
  const clusters = [...clusterMap.values()]
    .map((cluster) => ({
      ...cluster,
      velocity: round1(cluster.velocity / Math.max(cluster.narratives, 1)),
      uniqueAuthors: Math.max(1, Math.round(cluster.uniqueAuthors / Math.max(cluster.narratives, 1))),
      sharePct: normalizePct(cluster.attentionScore, clusterTotal),
    }))
    .sort((left, right) => right.attentionScore - left.attentionScore)
    .slice(0, 5);

  return {
    generatedAt,
    firehoseLagMinutes,
    attentionSharePct,
    engagementIntensity,
    meaningfulAttentionScore,
    narrativeCount: blueskyRanked.length,
    accountSpread,
    postsPerMinute,
    likesPerMinute,
    repostsPerMinute,
    repliesPerMinute,
    quotesPerMinute,
    accelerationScore,
    noiseRatioPct,
    leaders,
    emerging,
    topAmplifiers,
    cascades,
    clusters,
    network,
    replay,
  };
}
