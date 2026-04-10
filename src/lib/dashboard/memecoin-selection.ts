type SelectableMemecoinRow = {
  row: {
    id: string;
    isLive?: boolean | null;
    validationStatus?: string | null;
  };
};

function isSelectable(row: SelectableMemecoinRow) {
  return row.row.isLive !== false && row.row.validationStatus !== "invalid";
}

export function resolveSelectedLiveMemecoinId(
  rows: SelectableMemecoinRow[],
  requestedId: string | null | undefined,
) {
  const liveRows = rows.filter(isSelectable);
  if (requestedId && liveRows.some((row) => row.row.id === requestedId)) {
    return requestedId;
  }
  return liveRows[0]?.row.id ?? null;
}
