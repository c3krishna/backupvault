// Cloud retention — preview and purge S3 + OCI objects older than the retention window.

import { useCallback, useEffect, useState } from 'react';
import { maintenanceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Btn, Spinner, toast } from '../components/UI';

function providerLabel(p) {
  if (p === 'aws_s3' || p === 's3') return 'AWS S3';
  if (p === 'oci_object' || p === 'oci') return 'OCI';
  return p || '—';
}

export default function CloudPurge() {
  const { user } = useAuth();
  const canRun = user && (user.role === 'super_admin' || user.role === 'admin');
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPolicy(await maintenanceAPI.cloudRetention());
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function run(dryRun) {
    setBusy(dryRun ? 'preview' : 'purge');
    setConfirm(false);
    try {
      const summary = await maintenanceAPI.runCloudRetention({ dry_run: dryRun });
      setResult(summary);
      toast(dryRun
        ? `Preview: ${summary.expired || 0} object(s) older than ${summary.days} days`
        : `Purged ${summary.deleted || 0} object(s)`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const days = policy?.days || 30;

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'14px 22px 12px', borderBottom:'1px solid var(--bv-bd)', background:'var(--bv-bg2)', flexShrink:0 }}>
        <div style={{ fontSize:20, fontWeight:500, color:'var(--bv-txt)', display:'flex', alignItems:'center', gap:9 }}>
          <i className="ti ti-trash" style={{ color:'var(--bv-amber)', fontSize:22 }}/>
          Purge old backups
        </div>
        <div style={{ fontSize:12, color:'var(--bv-txt2)', marginTop:4 }}>
          Maintenance · keep the last {days} days on AWS S3 and OCI, then delete older dump objects.
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'16px 22px 28px' }}>
        {loading ? (
          <div style={{ display:'flex', alignItems:'center', gap:10, color:'var(--bv-txt3)', padding:24 }}>
            <Spinner size={22}/> Loading retention policy...
          </div>
        ) : (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10, marginBottom:14 }}>
              {[
                ['Keep', `${days} days`],
                ['Schedule', policy?.cron || '30 6 * * *'],
                ['Timezone', policy?.timezone || 'Asia/Kolkata'],
                ['Status', policy?.enabled ? 'Enabled' : 'Disabled'],
              ].map(([k, v]) => (
                <div key={k} style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)', borderRadius:10, padding:'12px 14px' }}>
                  <div style={{ fontSize:10, color:'var(--bv-txt3)', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:600 }}>{k}</div>
                  <div style={{ fontSize:15, color:'var(--bv-txt)', marginTop:4, fontWeight:500 }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ background:'var(--bv-amber-bg)', border:'1px solid var(--bv-amber)', borderRadius:10, padding:'12px 14px', fontSize:12, color:'var(--bv-txt2)', lineHeight:1.6, marginBottom:14 }}>
              This deletes backup objects on <strong>AWS S3</strong> and <strong>OCI</strong> whose last-modified time is older than {days} days.
              Only keys under <code>Backup_DB</code> or dump files (<code>.sql.gz</code>, <code>.enc</code>, <code>.dump</code>, <code>.rdb</code>) are removed.
              Primary NFS, Secondary NFS, and the remote DR host are not purged.
            </div>

            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:16 }}>
              <Btn variant="ghost" icon="eye" loading={busy==='preview'} disabled={!!busy || !canRun} onClick={() => run(true)}>
                Preview
              </Btn>
              {!confirm ? (
                <Btn variant="danger" icon="trash" disabled={!!busy || !canRun} onClick={() => setConfirm(true)}>
                  Purge now
                </Btn>
              ) : (
                <>
                  <Btn variant="danger" icon="alert-triangle" loading={busy==='purge'} disabled={!!busy} onClick={() => run(false)}>
                    Confirm delete older than {days} days
                  </Btn>
                  <Btn variant="ghost" disabled={!!busy} onClick={() => setConfirm(false)}>Cancel</Btn>
                </>
              )}
              {!canRun && (
                <span style={{ fontSize:12, color:'var(--bv-txt3)' }}>Admin role required to run a purge.</span>
              )}
            </div>

            {result && (
              <div style={{ background:'var(--bv-card)', border:'1px solid var(--bv-bd)', borderRadius:10, overflow:'hidden' }}>
                <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--bv-bd)', fontSize:12, color:'var(--bv-txt2)' }}>
                  {result.dryRun ? 'Preview' : 'Purge result'} · cutoff {result.cutoff ? new Date(result.cutoff).toLocaleString() : '—'}
                  {' · '}expired {result.expired || 0} · deleted {result.deleted || 0}
                  {result.errors ? ` · errors ${result.errors}` : ''}
                </div>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      {['Destination', 'Bucket', 'Scanned', 'Kept', 'Expired', 'Deleted', 'Error'].map(h => (
                        <th key={h} style={{ textAlign:'left', fontSize:10, color:'var(--bv-txt3)', letterSpacing:'.06em', textTransform:'uppercase', padding:'8px 12px', borderBottom:'1px solid var(--bv-bd)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(result.results || []).map((row, i) => (
                      <tr key={i}>
                        <td style={{ padding:'9px 12px', fontSize:12, borderBottom:'1px solid var(--bv-bd)' }}>
                          {providerLabel(row.provider)} · {row.name || '—'}
                        </td>
                        <td style={{ padding:'9px 12px', fontSize:12, fontFamily:'monospace', borderBottom:'1px solid var(--bv-bd)' }}>{row.bucket || '—'}</td>
                        <td style={{ padding:'9px 12px', fontSize:12, borderBottom:'1px solid var(--bv-bd)' }}>{row.scanned ?? '—'}</td>
                        <td style={{ padding:'9px 12px', fontSize:12, borderBottom:'1px solid var(--bv-bd)' }}>{row.kept ?? '—'}</td>
                        <td style={{ padding:'9px 12px', fontSize:12, borderBottom:'1px solid var(--bv-bd)' }}>{row.expired ?? '—'}</td>
                        <td style={{ padding:'9px 12px', fontSize:12, borderBottom:'1px solid var(--bv-bd)' }}>{row.deleted ?? 0}</td>
                        <td style={{ padding:'9px 12px', fontSize:12, color:'var(--bv-red)', borderBottom:'1px solid var(--bv-bd)' }}>{row.error || row.reason || ''}</td>
                      </tr>
                    ))}
                    {!(result.results || []).length && (
                      <tr><td colSpan={7} style={{ padding:20, textAlign:'center', color:'var(--bv-txt3)', fontSize:12 }}>No destinations returned.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
