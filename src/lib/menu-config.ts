import { allMenuItems, EXTRA_ROUTES, type MenuItem } from "@/lib/menu-tree";

function collectKeys(items: MenuItem[], acc: MenuItem[] = []): MenuItem[] {
  for (const it of items) {
    if (it.menuKey) acc.push(it);
    if (it.children) collectKeys(it.children, acc);
  }
  return acc;
}

export const MENU_STRUCTURE = allMenuItems
  .map((grp) => ({
    module: grp.label,
    items: collectKeys(grp.menuKey ? [grp, ...(grp.children ?? [])] : grp.children ?? []).map((it) => ({
      key: it.menuKey as string,
      label: it.label,
      ...(it.onlyView ? { onlyView: true as const } : {}),
    })),
  }))
  .filter((m) => m.items.length > 0);

export const MENU_KEY_TO_ROUTE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const it of collectKeys(allMenuItems)) if (it.path) m[it.menuKey as string] = it.path;
  return { ...m, ...EXTRA_ROUTES };
})();

export const ROUTE_TO_MENU_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(MENU_KEY_TO_ROUTE).map(([k, v]) => [v, k])
);

export const ALL_MENU_KEYS = Array.from(
  new Set([...collectKeys(allMenuItems).map((it) => it.menuKey as string), ...Object.keys(EXTRA_ROUTES)])
);
