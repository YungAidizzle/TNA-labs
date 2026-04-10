import {
  Bell,
  Bookmark,
  Coins,
  Database,
  History,
  LayoutDashboard,
  Radar,
  Settings2,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AppNavigationStatus = "available" | "coming-soon";
export type AppNavigationGroup = "workspace" | "intelligence" | "system";

export type AppNavigationItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  placeholderDescription: string;
  placeholderHighlights: string[];
  shortcut?: string;
  status: AppNavigationStatus;
  prominent?: boolean;
  group: AppNavigationGroup;
  matchPath: string;
  moduleId: string;
};

export const NAV_GROUPS = [
  { key: "workspace", label: "Workspace" },
  { key: "intelligence", label: "Intelligence" },
  { key: "system", label: "System" },
] as const satisfies ReadonlyArray<{
  key: AppNavigationGroup;
  label: string;
}>;

export const NAV_ITEMS: AppNavigationItem[] = [
  {
    id: "overview",
    label: "Overview",
    href: "/trends",
    icon: LayoutDashboard,
    description: "Live narrative-to-memecoin execution surface",
    placeholderDescription:
      "The live overview remains the operational entry point for the platform, combining ranked narratives, linked memecoin context, and validation workflow in one terminal surface.",
    placeholderHighlights: [
      "Narrative ranking, coin validation, and selection state are already live here.",
      "This is the only module currently unlocked while the wider platform rolls out.",
    ],
    shortcut: "1",
    status: "available",
    group: "workspace",
    matchPath: "/trends",
    moduleId: "WS-01",
  },
  {
    id: "watchlist",
    label: "Watchlist",
    href: "/watchlist",
    icon: Bookmark,
    description: "Save narratives, memecoins, and future custom screens",
    placeholderDescription:
      "Watchlist will let operators pin high-conviction narratives and memecoins into persistent monitoring lanes. Saved custom screens will join the same workflow as the product moves beyond a single live surface.",
    placeholderHighlights: [
      "Save narratives and memecoins into durable monitoring lists for follow-through.",
      "Custom screens and reusable operator views are planned as part of the same rollout.",
    ],
    status: "coming-soon",
    prominent: true,
    group: "workspace",
    matchPath: "/watchlist",
    moduleId: "WS-02",
  },
  {
    id: "alerts",
    label: "Alerts",
    href: "/alerts",
    icon: Bell,
    description: "Notification rules for narrative spikes and coin momentum",
    placeholderDescription:
      "Alerts will let the platform trigger notifications when narrative velocity, breakout conditions, or memecoin momentum cross operator-defined thresholds.",
    placeholderHighlights: [
      "Thresholds will cover narrative spikes, acceleration shifts, and coin breakout signals.",
      "Delivery is planned for terminal alerts first, with digest and webhook routes to follow.",
    ],
    status: "coming-soon",
    group: "workspace",
    matchPath: "/alerts",
    moduleId: "WS-03",
  },
  {
    id: "narratives",
    label: "Narratives",
    href: "/narratives",
    icon: Radar,
    description: "Deeper clustering, drilldowns, and narrative context",
    placeholderDescription:
      "Narratives will expand the current leaderboard into a deeper clustering and drilldown workspace, with clearer entity resolution, context, and evidence behind each theme.",
    placeholderHighlights: [
      "Move from headline ranking into grouped narrative clusters and structured drilldowns.",
      "Support richer context, evidence trails, and entity-level interpretation.",
    ],
    status: "coming-soon",
    group: "intelligence",
    matchPath: "/narratives",
    moduleId: "IN-01",
  },
  {
    id: "memecoins",
    label: "Memecoins",
    href: "/memecoins",
    icon: Coins,
    description: "Broader coin intelligence and discovery workflows",
    placeholderDescription:
      "Memecoins will broaden the product from validation of linked assets into a wider coin intelligence and discovery surface across the market.",
    placeholderHighlights: [
      "Cover broader pair intelligence, discovery, and cross-narrative link scoring.",
      "Extend beyond validation into a dedicated market reconnaissance module.",
    ],
    status: "coming-soon",
    group: "intelligence",
    matchPath: "/memecoins",
    moduleId: "IN-02",
  },
  {
    id: "momentum",
    label: "Momentum",
    href: "/momentum",
    icon: TrendingUp,
    description: "Early-stage acceleration and breakout detection",
    placeholderDescription:
      "Momentum will isolate early-stage acceleration before narratives or tokens fully crowd in, with a focus on short-horizon breakouts and regime shifts.",
    placeholderHighlights: [
      "Detect breakout conditions earlier than the main overview workflow.",
      "Track acceleration, pace changes, and regime transitions across short windows.",
    ],
    status: "coming-soon",
    group: "intelligence",
    matchPath: "/momentum",
    moduleId: "IN-03",
  },
  {
    id: "influencers",
    label: "Influencers",
    href: "/influencers",
    icon: Users,
    description: "Identify the accounts and channels driving attention",
    placeholderDescription:
      "Influencers will identify which accounts, channels, and operators are actually driving narrative spread instead of just participating in it.",
    placeholderHighlights: [
      "Rank sources by attention lift, propagation impact, and timing quality.",
      "Separate audience size from actual narrative-driving influence.",
    ],
    status: "coming-soon",
    group: "intelligence",
    matchPath: "/influencers",
    moduleId: "IN-04",
  },
  {
    id: "historical-replay",
    label: "Historical Replay",
    href: "/historical-replay",
    icon: History,
    description: "Inspect how narratives formed before major events",
    placeholderDescription:
      "Historical Replay will let users inspect what narratives were forming before major news, market, or memecoin events so setups can be reviewed in sequence, not hindsight.",
    placeholderHighlights: [
      "Replay build-up, acceleration, and confirmation across prior windows.",
      "Review what the market noticed before major events, not just after them.",
    ],
    status: "coming-soon",
    group: "intelligence",
    matchPath: "/historical-replay",
    moduleId: "IN-05",
  },
  {
    id: "api-data-export",
    label: "API / Data Export",
    href: "/api-data-export",
    icon: Database,
    description: "Programmatic access and downloadable datasets",
    placeholderDescription:
      "API / Data Export will expose programmatic access to scored narratives, linked assets, and historical windows, with downloadable datasets for research and workflow automation.",
    placeholderHighlights: [
      "Programmatic access is planned for dashboard entities, histories, and linked assets.",
      "Downloadable datasets will support repeatable research and external pipelines.",
    ],
    status: "coming-soon",
    group: "system",
    matchPath: "/api-data-export",
    moduleId: "SY-01",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings2,
    description: "Product, workflow, and user configuration",
    placeholderDescription:
      "Settings will consolidate product, workspace, and user configuration as more modules unlock and operator preferences become persistent.",
    placeholderHighlights: [
      "Saved defaults, rollout controls, and account configuration will live here.",
      "This will become the control surface for terminal behavior as the platform expands.",
    ],
    status: "coming-soon",
    group: "system",
    matchPath: "/settings",
    moduleId: "SY-02",
  },
];

const SIDEBAR_NAV_ITEM_IDS = new Set<string>([
  "overview",
  "watchlist",
  "alerts",
  "narratives",
  "memecoins",
  "api-data-export",
]);

export const GROUPED_NAV_ITEMS = NAV_GROUPS.map((group) => ({
  ...group,
  items: NAV_ITEMS.filter((item) => item.group === group.key),
}));

export function getSidebarNavigationGroups(pathname: string) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: NAV_ITEMS.filter(
      (item) =>
        item.group === group.key &&
        (SIDEBAR_NAV_ITEM_IDS.has(item.id) || isNavigationItemActive(pathname, item)),
    ),
  })).filter((group) => group.items.length > 0);
}

export const NAV_ITEMS_BY_ID = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.id, item]),
) as Record<string, AppNavigationItem>;

const DASHBOARD_SURFACE_PATHS = ["/trends"] as const;

export function isDashboardSurfacePath(pathname: string) {
  return DASHBOARD_SURFACE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isNavigationItemActive(pathname: string, item: AppNavigationItem) {
  return pathname === item.matchPath || pathname.startsWith(`${item.matchPath}/`);
}

export function getNavigationItemByPathname(pathname: string) {
  return NAV_ITEMS.find((item) => isNavigationItemActive(pathname, item)) ?? null;
}

export function getNavigationGroupLabel(group: AppNavigationGroup) {
  return NAV_GROUPS.find((item) => item.key === group)?.label ?? "Workspace";
}
