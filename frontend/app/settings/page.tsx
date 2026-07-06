'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, updateAccount, updateRiskPct } from '../../lib/api';
import { Settings, TierStatus } from '../../lib/types';

const ACK_STRING = 'I ACCEPT THE DRAWDOWN RISK';
const HARD_CEILING = 3.0;

// Engine rules are frozen (backend config); shown read-only so the rules stay visible.
const ENGINE_RULES: Array<[string, string]> = [
  ['Min confluence (core)', '4 / 6'],
  ['Min confluence (experimental 15min)', '5 / 6'],
  ['Min reward:risk', '2.0 : 1'],
  ['Signal timeframes', '1h, 4h (core) · 15min (experimental)'],
  ['Higher-TF trend (F1)', '1h→4h, 4h→1day, 15min→1h'],
  ['Risk ceiling', '3.0% (hard cap)'],
];

export default function SettingsPage() {
  const [tier, setTier] = useState<TierStatus | null>(null);
  const [accountSize, setAccountSize] = useState('2000');
  const [ccy, setCcy] = useState('GBP');
  const [riskPct, setRiskPct] = useState(1.0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ackInput, setAckInput] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [acctMsg, setAcctMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadTier = useCallback(async () => {
    try {
      setTier(await apiGet<TierStatus>('api/sizing/tier-status'));
    } catch {
      /* ignore */
    }
  }, []);
  const loadSettings = useCallback(async () => {
    try {
      const s = await apiGet<Settings>('api/settings');
      setAccountSize(String(s.account_size));
      setCcy(s.account_ccy);
      setRiskPct(s.risk_pct);
    } catch {
      /* keep defaults */
    }
  }, []);
  useEffect(() => {
    void loadTier();
    void loadSettings();
  }, [loadTier, loadSettings]);

  async function saveAccount() {
    setAcctMsg(null);
    try {
      const res = await updateAccount(Number(accountSize), ccy);
      setAcctMsg({ ok: true, text: `Saved: ${res.account_ccy} ${res.account_size}.` });
    } catch (e) {
      setAcctMsg({ ok: false, text: (e as Error).message });
    }
  }

  const isTier2 = riskPct > 2.0;
  const locked = isTier2 && !tier?.tier2_unlocked;

  async function save(ack?: string) {
    setMsg(null);
    try {
      const res = await updateRiskPct(riskPct, ack);
      setMsg({ ok: true, text: `Saved: risk ${res.risk_pct}% (Tier ${res.tier}).` });
      setDialogOpen(false);
      setAckInput('');
      void loadTier();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  function onSaveClick() {
    if (riskPct > HARD_CEILING) {
      setMsg({ ok: false, text: `Blocked: ${riskPct}% exceeds the ${HARD_CEILING}% hard ceiling.` });
      return;
    }
    if (isTier2) {
      if (locked) {
        setMsg({ ok: false, text: 'Tier 2 is locked. Save is disabled until the gate is met.' });
        return;
      }
      setDialogOpen(true); // unlocked Tier 2 → require typed acknowledgment
      return;
    }
    void save();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="rounded-lg border border-neutral-800">
        <div className="border-b border-neutral-800 px-4 py-2 text-sm font-semibold text-neutral-300">
          Engine rules (read-only)
        </div>
        <dl className="divide-y divide-neutral-800 text-sm">
          {ENGINE_RULES.map(([k, v]) => (
            <div key={k} className="flex justify-between px-4 py-2">
              <dt className="text-neutral-500">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-lg border border-neutral-800 p-4">
        <h2 className="text-sm font-semibold text-neutral-300">Money management</h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-neutral-500">Account size</span>
            <input
              type="number"
              value={accountSize}
              onChange={(e) => setAccountSize(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="text-neutral-500">Account currency</span>
            <select
              value={ccy}
              onChange={(e) => setCcy(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5"
            >
              <option>GBP</option>
              <option>USD</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void saveAccount()}
            className="rounded bg-neutral-200 px-4 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-neutral-300"
          >
            Save account
          </button>
          {acctMsg && <span className={`text-sm ${acctMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{acctMsg.text}</span>}
        </div>

        <div className="mt-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">Risk per trade</span>
            <span className={`font-semibold ${isTier2 ? 'text-amber-300' : ''}`}>{riskPct.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={HARD_CEILING}
            step={0.1}
            value={riskPct}
            onChange={(e) => setRiskPct(Number(e.target.value))}
            className="mt-2 w-full accent-amber-500"
          />
          <div className="mt-1 flex justify-between text-xs text-neutral-600">
            <span>0.5% (min)</span>
            <span>2.0% (Tier 1 max)</span>
            <span>3.0% (hard cap)</span>
          </div>
          {isTier2 && (
            <p className={`mt-2 text-xs ${locked ? 'text-red-400' : 'text-amber-300'}`}>
              Tier 2 (ELEVATED). {locked ? 'LOCKED' : 'Unlocked'} — requires ≥50 resolved signals AND
              cumulative R &gt; 0.
            </p>
          )}
        </div>

        <button
          onClick={onSaveClick}
          disabled={locked}
          className="mt-4 rounded bg-amber-500/90 px-4 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save risk %
        </button>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
        <p className="mt-2 text-xs text-neutral-600">
          Account and risk settings persist through token-guarded endpoints. All writes route through
          a server-side proxy; the admin token never reaches the browser.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-800 p-4 text-sm">
        <h2 className="font-semibold text-neutral-300">Tier status</h2>
        {tier ? (
          <p className="mt-2 text-neutral-400">
            {tier.tier2_unlocked ? (
              <span className="text-green-400">Tier 2 unlocked.</span>
            ) : (
              <>
                Tier 2 locked — {tier.progress} resolved, cumulative R: {tier.cumulative_r}
              </>
            )}
          </p>
        ) : (
          <p className="mt-2 text-neutral-600">Loading…</p>
        )}
      </section>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-amber-500/40 bg-neutral-900 p-5">
            <h3 className="text-lg font-semibold text-amber-300">Confirm elevated risk ({riskPct.toFixed(1)}%)</h3>
            <div className="mt-3 space-y-2 text-sm text-neutral-300">
              <p>Elevated risk compounds drawdowns fast. At 3% per trade:</p>
              <ul className="list-disc pl-5 text-neutral-400">
                <li>A 6-loss streak ≈ <span className="text-red-400">−16.7%</span> of account.</li>
                <li>Recovering that loss requires ≈ <span className="text-amber-300">+20%</span>.</li>
              </ul>
              <p>Type <span className="font-mono text-neutral-100">{ACK_STRING}</span> to proceed.</p>
            </div>
            <input
              value={ackInput}
              onChange={(e) => setAckInput(e.target.value)}
              placeholder={ACK_STRING}
              className="mt-3 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setDialogOpen(false);
                  setAckInput('');
                }}
                className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={() => void save(ackInput)}
                disabled={ackInput !== ACK_STRING}
                className="rounded bg-red-500/90 px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                I accept — set {riskPct.toFixed(1)}%
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
