import React from 'react';

/**
 * Shared result grid + pager. Consumes the payload shape returned by both
 * /api/query/execute and /api/reports/:key/run, so one component serves both.
 */

const PAGE_SIZES = [20, 50, 100];

function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

export default function ResultTable({ result, busy, onPage, onPageSize, onExport, children }) {
  if (!result) return null;

  const first = (result.page - 1) * result.pageSize + 1;
  const last = Math.min(result.page * result.pageSize, result.totalRows);

  return (
    <section className="qe-results">
      <div className="qe-status">
        <span><strong>{result.totalRows.toLocaleString()}</strong> rows</span>
        <span>{result.durationMs} ms</span>
        <span>{result.statementType} · {result.connectionName}</span>
        {result.truncated && (
          <span className="qe-warn">
            Capped at {result.maxRows.toLocaleString()} rows — narrow the range to see the rest
          </span>
        )}
        <div className="qe-status-right">
          <label htmlFor="qe-size">Rows per page</label>
          <select
            id="qe-size"
            value={result.pageSize}
            disabled={busy}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {onExport && <button className="qe-ghost" onClick={onExport}>Download CSV</button>}
          {children}
        </div>
      </div>

      {result.totalRows === 0 ? (
        <p className="qe-empty">No rows for these parameters. Try a different date or domain.</p>
      ) : (
        <>
          <div className="qe-table-wrap">
            <table className="qe-table">
              <thead>
                <tr>
                  <th className="qe-rownum">#</th>
                  {result.columns.map((col) => <th key={col} title={col}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="qe-rownum">{first + i}</td>
                    {row.map((cell, j) => (
                      <td key={j} title={cell === null ? 'NULL' : String(cell)}>
                        {cell === null || cell === '' ? <span className="qe-null">—</span> : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="qe-pager" aria-label="Result pages">
            <span className="qe-range">
              {first.toLocaleString()}–{last.toLocaleString()} of {result.totalRows.toLocaleString()}
            </span>
            <div className="qe-pager-buttons">
              <button disabled={result.page === 1 || busy} onClick={() => onPage(1)}>« First</button>
              <button disabled={result.page === 1 || busy} onClick={() => onPage(result.page - 1)}>Prev</button>
              {pageWindow(result.page, result.totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="qe-gap">…</span>
                ) : (
                  <button
                    key={p}
                    className={p === result.page ? 'is-current' : ''}
                    disabled={busy}
                    aria-current={p === result.page ? 'page' : undefined}
                    onClick={() => onPage(p)}
                  >
                    {p}
                  </button>
                )
              )}
              <button disabled={result.page === result.totalPages || busy} onClick={() => onPage(result.page + 1)}>Next</button>
              <button disabled={result.page === result.totalPages || busy} onClick={() => onPage(result.totalPages)}>Last »</button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}
