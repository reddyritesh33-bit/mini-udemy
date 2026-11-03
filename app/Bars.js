// A plain horizontal bar chart: no chart library needed for the report pages.
export default function Bars({ rows, label, value, suffix = "" }) {
  const max = Math.max(...rows.map((r) => Number(r[value]) || 0), 1);
  return (
    <div style={{ margin: "8px 0 16px" }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "3px 0" }}>
          <span style={{ width: 230, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={String(r[label])}>
            {r[label]}
          </span>
          <div style={{ flex: 1, background: "#f0f0f0", borderRadius: 3, height: 14 }}>
            <div style={{ width: `${(100 * (Number(r[value]) || 0)) / max}%`, height: "100%", background: "#3b82f6", borderRadius: 3 }} />
          </div>
          <span style={{ width: 70, textAlign: "right" }}>{r[value]}{suffix}</span>
        </div>
      ))}
    </div>
  );
}
