interface ManuallyOrdered {
  sortOrder?: number;
  createdAt?: string;
  title?: string;
  name?: string;
  pinnedAt?: string;
}

export function manualOrderValue(item: ManuallyOrdered) {
  return item.sortOrder ?? (Date.parse(item.createdAt ?? "") || Number.MAX_SAFE_INTEGER);
}

export function compareManualOrder(left: ManuallyOrdered, right: ManuallyOrdered) {
  if (left.sortOrder === undefined && right.sortOrder === undefined && Boolean(left.pinnedAt) !== Boolean(right.pinnedAt)) {
    return left.pinnedAt ? -1 : 1;
  }
  const leftOrder = manualOrderValue(left);
  const rightOrder = manualOrderValue(right);
  return leftOrder - rightOrder
    || (left.title ?? left.name ?? "").localeCompare(right.title ?? right.name ?? "", "zh-CN");
}

export function moveOrderedItem(ids: string[], draggedId: string, targetId: string) {
  const from = ids.indexOf(draggedId);
  const target = ids.indexOf(targetId);
  if (from < 0 || target < 0 || from === target) return ids;
  const next = [...ids];
  const [dragged] = next.splice(from, 1);
  next.splice(target, 0, dragged);
  return next;
}

export function mergeVisibleOrder(allIds: string[], visibleIds: string[]) {
  const visibleSet = new Set(visibleIds);
  let index = 0;
  return allIds.map((id) => visibleSet.has(id) ? visibleIds[index++] : id);
}
