import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ResultTable from './ResultTable';
import './QueryExecution.css';

/**
 * BackupVault :: Reports
 *
 *   <Route path="/reports" element={<ReportRunner />} />
 *
 * Report results are cached by the same store the ad-hoc query page uses, so
 * paging and CSV export hit /api/query/:executionId/... unchanged.
 */

// ─── ADJUST: matches QueryExecution.jsx ─────────────────────────────────────
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
    throw err;
  }
  return body;
}
// ────────────────────────────────────────────────────────────────────────────

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function defaultValue(param) {
  if (param.type === 'date') {
    if (param.default === 'today' || !param.default) return todayIso();
    if (param.default === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    return param.default;
  }
  return param.default ?? '';
}

export default function ReportRunner() {
  const [reports, setReports] = useState([]);
  const [activeKey, setActiveKey] = useState('');
  const [params, setParams] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [runs, setRuns] = useState([]);

  const [mailOpen, setMailOpen] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [sending, setSending] = useState(false);

  const active = useMemo(() => reports.find((r) => r.key === activeKey), [reports, activeKey]);

  useEffect(() => {
    api('/reports')
      .then((b) => {
        setReports(b.reports || []);
        if (b.reports?.length) setActiveKey(b.reports[0].key);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Reset parameters and recipients when the selected report changes
  useEffect(() => {
    if (!active) return;
    const next = {};
    for (const p of active.params || []) next[p.name] = defaultValue(p);
    setParams(next);
    setRecipients((active.email?.to || []).join(', '));
    setResult(null);
    setError(null);
    setNotice(null);
  }, [active]);

  const loadRuns = useCallback(() => {
    if (!activeKey) return;
    api(`/reports/runs?key=${activeKey}&limit=10`).then((b) => setRuns(b.runs || [])).catch(() => {});
  }, [activeKey]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = await api(`/reports/${activeKey}/run`, {
        method: 'POST',
        body: JSON.stringify({ params }),
      });
      setResult(body);
      loadRuns();
    } catch (e) {
      setError(e.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const goToPage = async (page, size) => {
    if (!result?.executionId) return;
    setBusy(true);
    try {
      const body = await api(`/query/${result.executionId}/page/${page}?size=${size || result.pageSize}`);
      setResult(body);
    } catch (e) {
      setError(e.message);
      if (e.code === 'EXPIRED') setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => window.open(`${API_BASE}/query/${result.executionId}/export.csv`, '_blank');

  const sendMail = async () => {
    setSending(true);
    setError(null);
    try {
      const to = recipients.split(',').map((s) => s.trim()).filter(Boolean);
      const body = await api(`/reports/${activeKey}/email`, {
        method: 'POST',
        body: JSON.stringify({ executionId: result?.executionId, params, recipients: to }),
      });
      setNotice(`Sent ${body.filename} (${(body.bytes / 1024).toFixed(1)} KB, ${body.rowCount.toLocaleString()} rows) to ${body.to.join(', ')}`);
      setMailOpen(false);
      loadRuns();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="qe-root qe-live">
      <header className="qe-head">
        <div>
          <h1 className="qe-title">Reports</h1>
          <p className="qe-sub">Saved reports that span multiple database servers.</p>
        </div>
      </header>

      <section className="qe-targets">
        <div className="qe-field qe-grow">
          <label htmlFor="rp-report">Report</label>
          <select id="rp-report" value={activeKey} onChange={(e) => setActiveKey(e.target.value)}>
            {reports.length === 0 && <option value="">No report definitions found</option>}
            {reports.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </div>

        {(active?.params || []).map((p) => (
          <div className="qe-field" key={p.name}>
            <label htmlFor={`rp-${p.name}`}>{p.label || p.name}</label>
            <input
              id={`rp-${p.name}`}
              type={p.type === 'date' ? 'date' : 'text'}
              inputMode={p.type === 'int' ? 'numeric' : undefined}
              value={params[p.name] ?? ''}
              onChange={(e) => setParams((s) => ({ ...s, [p.name]: e.target.value }))}
            />
          </div>
        ))}

        <div className="qe-field qe-field-action">
          <button className="qe-run" onClick={run} disabled={busy || !activeKey}>
            {busy ? 'Running…' : 'Run report'}
          </button>
        </div>
      </section>

      {active?.description && <p className="qe-desc">{active.description}</p>}

      {active && (
        <ul className="qe-steps">
          {active.steps.map((s) => (
            <li key={s.id}>
              <code>{s.id}</code>
              <span className="qe-meta">{s.type} · {s.connection}</span>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="qe-error" role="alert"><span className="qe-error-tag">Failed</span>{error}</div>}
      {notice && <div className="qe-notice" role="status">{notice}</div>}

      {result?.steps && (
        <div className="qe-substats">
          {result.steps.map((s) => (
            <span key={s.id}>{s.id}: {s.rows.toLocaleString()} rows / {s.durationMs} ms</span>
          ))}
        </div>
      )}

      <ResultTable
        result={result}
        busy={busy}
        onPage={(p) => goToPage(p)}
        onPageSize={(size) => goToPage(1, size)}
        onExport={exportCsv}
      >
        <button className="qe-run qe-run-sm" onClick={() => setMailOpen(true)} disabled={busy}>
          Email report
        </button>
      </ResultTable>

      {runs.length > 0 && (
        <section className="qe-history">
          <h2>Recent runs</h2>
          <ul>
            {runs.map((r) => (
              <li key={r.execution_id}>
                <span className={`qe-chip qe-chip-${String(r.status).toLowerCase()}`}>{r.status}</span>
                <span className="qe-meta">
                  {new Date(r.created_at).toLocaleString()} · {r.trigger_type} · {r.username} ·{' '}
                  {r.row_count.toLocaleString()} rows · {r.duration_ms} ms
                  {r.emailed_to ? ` · mailed to ${r.emailed_to}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mailOpen && (
        <div className="qe-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rp-mail-title">
          <div className="qe-modal">
            <h2 id="rp-mail-title">Email {active?.name}</h2>
            <p>
              The CSV attaches {result ? `${result.totalRows.toLocaleString()} rows already on screen` : 'a fresh run of this report'}.
            </p>
            <label htmlFor="rp-to">Recipients</label>
            <input
              id="rp-to"
              className="qe-input-wide"
              value={recipients}
              placeholder="operations@company.com, noc@company.com"
              onChange={(e) => setRecipients(e.target.value)}
            />
            <div className="qe-modal-actions">
              <button className="qe-ghost" onClick={() => setMailOpen(false)}>Cancel</button>
              <button className="qe-run" onClick={sendMail} disabled={sending || !recipients.trim()}>
                {sending ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
