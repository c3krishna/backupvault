import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './QueryExecution.css';

/**
 * BackupVault :: Query Execution
 *
 * Drop into src/pages/ and add a route + sidebar entry:
 *   <Route path="/query" element={<QueryExecution />} />
 *
 * No new npm dependencies. To upgrade the editor later, swap the <textarea>
 * for @uiw/react-codemirror with @codemirror/lang-sql — nothing else changes.
 */

// ─── ADJUST: your API base + auth header convention ─────────────────────────
// CRA/webpack: process.env.REACT_APP_*   |   Vite: import.meta.env.VITE_*
// `import.meta` is a hard syntax error in a CRA build, so it cannot appear here.
const API_BASE = process.env.REACT_APP_API_BASE || '/api';

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const err = new Error(body.message || `Request failed (${res.status})`);
    err.code = body.code;
    err.status = res.status;
    throw err;
  }
  return body;
}
// ────────────────────────────────────────────────────────────────────────────

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

export default function QueryExecution() {
  const [environment, setEnvironment] = useState('QA');
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState('');
  const [database, setDatabase] = useState('');
  const [sql, setSql] = useState('SELECT * FROM information_schema.tables LIMIT 100;');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);     // { columns, rows, page, totalPages, ... }
  const [error, setError] = useState(null);
  const [pageSize, setPageSize] = useState(20);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  const editorRef = useRef(null);
  const selected = useMemo(
    () => connections.find((c) => String(c.id) === String(connectionId)),
    [connections, connectionId]
  );
  const isLive = selected?.environment === 'LIVE';

  /* ── load connections whenever the environment changes ─────────────────── */
  useEffect(() => {
    let cancelled = false;
    api(`/query/connections?environment=${environment}`)
      .then((body) => {
        if (cancelled) return;
        setConnections(body.connections || []);
        setConnectionId((prev) => {
          const stillThere = (body.connections || []).some((c) => String(c.id) === String(prev));
          return stillThere ? prev : (body.connections?.[0]?.id ?? '');
        });
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [environment]);

  const loadHistory = useCallback(() => {
    api('/query/history?limit=25').then((b) => setHistory(b.history || [])).catch(() => {});
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  /* ── run ───────────────────────────────────────────────────────────────── */
  const run = useCallback(async (confirmLive = false) => {
    if (!connectionId) { setError('Select a target connection first.'); return; }
    if (!sql.trim()) { setError('Enter a statement to run.'); return; }

    setRunning(true);
    setError(null);
    try {
      const body = await api('/query/execute', {
        method: 'POST',
        body: JSON.stringify({ connectionId, sql, database: database || undefined, pageSize, confirmLive }),
      });
      setResult(body);
      setPendingConfirm(false);
      loadHistory();
    } catch (err) {
      if (err.code === 'CONFIRM_REQUIRED') setPendingConfirm(true);
      else { setError(err.message); setResult(null); }
    } finally {
      setRunning(false);
    }
  }, [connectionId, sql, database, pageSize, loadHistory]);

  const startRun = () => (isLive ? setPendingConfirm(true) : run(false));

  /* ── paging ────────────────────────────────────────────────────────────── */
  const goToPage = useCallback(async (page, size = pageSize) => {
    if (!result?.executionId) return;
    setRunning(true);
    try {
      const body = await api(`/query/${result.executionId}/page/${page}?size=${size}`);
      setResult(body);
      setError(null);
    } catch (err) {
      setError(err.message);
      if (err.code === 'EXPIRED') setResult(null);
    } finally {
      setRunning(false);
    }
  }, [result, pageSize]);

  const changePageSize = (size) => {
    setPageSize(size);
    if (result?.executionId) goToPage(1, size);
  };

  const downloadCsv = () => {
    if (!result?.executionId) return;
    window.open(`${API_BASE}/query/${result.executionId}/export.csv`, '_blank');
  };

  /* ── Ctrl/Cmd + Enter to run ───────────────────────────────────────────── */
  const onEditorKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); startRun(); }
  };

  const firstRowIndex = result ? (result.page - 1) * result.pageSize + 1 : 0;
  const lastRowIndex = result ? Math.min(result.page * result.pageSize, result.totalRows) : 0;

  return (
    <div className={`qe-root ${isLive ? 'qe-live' : 'qe-qa'}`}>
      <header className="qe-head">
        <div>
          <h1 className="qe-title">Query Execution</h1>
          <p className="qe-sub">Read-only SQL and stored procedures against registered targets.</p>
        </div>
        <button className="qe-ghost" onClick={() => setShowHistory((s) => !s)}>
          {showHistory ? 'Hide history' : 'Recent queries'}
        </button>
      </header>

      {isLive && (
        <div className="qe-banner" role="status">
          <strong>Production target.</strong> Statements run against LIVE data and every execution is recorded
          with your username and IP.
        </div>
      )}

      {/* ── target bar ──────────────────────────────────────────────────── */}
      <section className="qe-targets">
        <div className="qe-field qe-env">
          <label>Environment</label>
          <div className="qe-segment" role="group" aria-label="Environment">
            {['QA', 'LIVE'].map((env) => (
              <button
                key={env}
                type="button"
                className={environment === env ? 'is-active' : ''}
                onClick={() => setEnvironment(env)}
              >
                {env}
              </button>
            ))}
          </div>
        </div>

        <div className="qe-field qe-grow">
          <label htmlFor="qe-conn">Server</label>
          <select id="qe-conn" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            {connections.length === 0 && <option value="">No query-enabled servers in {environment}</option>}
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.host} ({c.db_engine})
              </option>
            ))}
          </select>
        </div>

        <div className="qe-field">
          <label htmlFor="qe-db">Database</label>
          <input
            id="qe-db"
            value={database}
            placeholder={selected?.db_name || 'default'}
            onChange={(e) => setDatabase(e.target.value)}
          />
        </div>
      </section>

      {/* ── editor ──────────────────────────────────────────────────────── */}
      <section className="qe-editor">
        <textarea
          ref={editorRef}
          value={sql}
          spellCheck={false}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onEditorKeyDown}
          placeholder="SELECT ... &#10;CALL sp_daily_summary('2026-08-01');"
          aria-label="SQL statement"
        />
        <div className="qe-actions">
          <span className="qe-hint">One statement at a time · Ctrl+Enter to run</span>
          <div className="qe-action-buttons">
            <button className="qe-ghost" onClick={() => { setSql(''); editorRef.current?.focus(); }}>
              Clear
            </button>
            <button className="qe-run" onClick={startRun} disabled={running || !connectionId}>
              {running ? 'Running…' : isLive ? 'Run on LIVE' : 'Run query'}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="qe-error" role="alert">
          <span className="qe-error-tag">Blocked</span>
          {error}
        </div>
      )}

      {/* ── results ─────────────────────────────────────────────────────── */}
      {result && (
        <section className="qe-results">
          <div className="qe-status">
            <span><strong>{result.totalRows.toLocaleString()}</strong> rows</span>
            <span>{result.durationMs} ms</span>
            <span>{result.statementType} on {result.connectionName}</span>
            {result.truncated && (
              <span className="qe-warn">
                Capped at {result.maxRows.toLocaleString()} rows — narrow the query to see the rest
              </span>
            )}
            <div className="qe-status-right">
              <label htmlFor="qe-size">Rows per page</label>
              <select
                id="qe-size"
                value={result.pageSize}
                onChange={(e) => changePageSize(Number(e.target.value))}
              >
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="qe-ghost" onClick={downloadCsv}>Download CSV</button>
            </div>
          </div>

          {result.totalRows === 0 ? (
            <p className="qe-empty">The query ran successfully and returned no rows.</p>
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
                        <td className="qe-rownum">{firstRowIndex + i}</td>
                        {row.map((cell, j) => (
                          <td key={j} title={cell === null ? 'NULL' : String(cell)}>
                            {cell === null ? <span className="qe-null">NULL</span> : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <nav className="qe-pager" aria-label="Result pages">
                <span className="qe-range">
                  {firstRowIndex.toLocaleString()}–{lastRowIndex.toLocaleString()} of {result.totalRows.toLocaleString()}
                </span>
                <div className="qe-pager-buttons">
                  <button disabled={result.page === 1 || running} onClick={() => goToPage(1)}>« First</button>
                  <button disabled={result.page === 1 || running} onClick={() => goToPage(result.page - 1)}>Prev</button>
                  {pageWindow(result.page, result.totalPages).map((p, idx) =>
                    p === '…' ? (
                      <span key={`gap-${idx}`} className="qe-gap">…</span>
                    ) : (
                      <button
                        key={p}
                        className={p === result.page ? 'is-current' : ''}
                        disabled={running}
                        aria-current={p === result.page ? 'page' : undefined}
                        onClick={() => goToPage(p)}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button disabled={result.page === result.totalPages || running} onClick={() => goToPage(result.page + 1)}>Next</button>
                  <button disabled={result.page === result.totalPages || running} onClick={() => goToPage(result.totalPages)}>Last »</button>
                </div>
              </nav>
            </>
          )}
        </section>
      )}

      {/* ── history ─────────────────────────────────────────────────────── */}
      {showHistory && (
        <section className="qe-history">
          <h2>Recent queries</h2>
          {history.length === 0 && <p className="qe-empty">Nothing yet. Your executions will appear here.</p>}
          <ul>
            {history.map((h) => (
              <li key={h.execution_id}>
                <button onClick={() => { setSql(h.sql_preview); editorRef.current?.focus(); }}>
                  <code>{h.sql_preview}</code>
                </button>
                <span className={`qe-chip qe-chip-${String(h.status).toLowerCase()}`}>{h.status}</span>
                <span className="qe-meta">
                  {h.environment} · {h.connection_name} · {h.row_count} rows · {h.duration_ms} ms
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── LIVE confirmation ───────────────────────────────────────────── */}
      {pendingConfirm && (
        <div className="qe-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="qe-confirm-title">
          <div className="qe-modal">
            <h2 id="qe-confirm-title">Run against {selected?.name}?</h2>
            <p>
              This is a <strong>LIVE</strong> target ({selected?.host}). The statement is read-only and time-limited,
              but it will read production data and the execution is logged.
            </p>
            <pre>{sql.trim().slice(0, 400)}</pre>
            <div className="qe-modal-actions">
              <button className="qe-ghost" onClick={() => setPendingConfirm(false)}>Cancel</button>
              <button className="qe-run" onClick={() => run(true)} disabled={running}>
                {running ? 'Running…' : 'Run on LIVE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
