import {
  LayoutDashboard,
  Settings2,
  type LucideIcon,
} from "lucide-react";

export type AppNavigationGroup = "workspace" | "system";

export type AppNavigationItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  shortcut?: string;
  group: AppNavigationGroup;
  matchPath: string;
  moduleId: string;
};

export const NAV_GROUPS = [
  { key: "workspace", label: "Workspace" },
  { key: "system", label: "System" },
] as const satisfies ReadonlyArray<{
  key: AppNavigationGroup;
  label: string;
}>;

export const NAV_ITEMS: AppNavigationItem[] = [
  {
    id: "trends",
    label: "Trends",
    href: "/trends",
    icon: LayoutDashboard,
    description: "Live narrative rankings, linked memecoins, and validation context",
    shortcut: "1",
    group: "workspace",
    matchPath: "/trends",
    moduleId: "WS-01",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings2,
    description: "Account access, billing, and current legal acknowledgements",
    shortcut: "2",
    group: "system",
    matchPath: "/settings",
    moduleId: "SY-01",
  },
];

export const GROUPED_NAV_ITEMS = NAV_GROUPS.map((group) => ({
  ...group,
  items: NAV_ITEMS.filter((item) => item.group === group.key),
}));

export function getSidebarNavigationGroups() {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: NAV_ITEMS.filter((item) => item.group === group.key),
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
