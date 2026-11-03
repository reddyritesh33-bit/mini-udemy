// Renders any list of row objects as a table, using the keys of the first row as headings.
export default function Table({ rows }) {
  if (!rows || rows.length === 0) return <p style={{ color: "#666" }}>No rows.</p>;
  const cols = Object.keys(rows[0]);
  const cell = { borderBottom: "1px solid #eee", padding: "4px 8px", textAlign: "left" };
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%", marginBottom: 8 }}>
      <thead>
        <tr>{cols.map((c) => <th key={c} style={{ ...cell, borderBottom: "2px solid #ddd" }}>{c.replace(/_/g, " ")}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{cols.map((c) => <td key={c} style={cell}>{r[c] === null ? "-" : String(r[c])}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
