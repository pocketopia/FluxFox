'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, CheckCircle2, CircleAlert, Loader2, MapPin, RotateCcw, Save } from 'lucide-react';
import { INDUSTRY_OPTIONS } from '@/components/dashboard/FluxFoxConsole';

interface BusinessSettings {
  businessName: string;
  industry: string;
  businessAddress: string;
  systemPrompt: string;
}

const EMPTY: BusinessSettings = { businessName: '', industry: '', businessAddress: '', systemPrompt: '' };

const FIELD =
  'w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50';

/**
 * View / edit / reset the business name, business type, street address and VA
 * system prompt (`/api/assistant/settings`). Works before AND after the
 * assistant is deployed: once deployed, Save syncs straight to the live Vapi
 * assistant (PATCH /assistant/{id}); Reset clears everything to a clean slate.
 */
export default function AiSettingsPanel({ isDeployed }: { isDeployed: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<BusinessSettings>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/assistant/settings', { cache: 'no-store' });
        const data = (await res.json().catch(() => null)) as (BusinessSettings & { error?: string }) | null;
        if (!res.ok || !data) throw new Error(data?.error || 'Failed to load your business settings.');
        if (!cancelled) setForm({ ...EMPTY, ...data });
      } catch (err) {
        if (!cancelled) {
          setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to load settings.' });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setMessage(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/assistant/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; syncedToVapi?: boolean } | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to save your settings.');
      setMessage({
        kind: 'ok',
        text: data?.syncedToVapi ? 'Saved and synced to your live AI receptionist.' : 'Saved.',
      });
      router.refresh();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to save your settings.' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    if (!window.confirm('Reset your business name, type, address and AI prompt to a clean slate?')) return;
    setMessage(null);
    setIsResetting(true);
    try {
      const res = await fetch('/api/assistant/settings', { method: 'DELETE' });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to reset your settings.');
      setForm(EMPTY);
      setMessage({ kind: 'ok', text: 'Cleared. You can now reconfigure your business from scratch.' });
      router.refresh();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to reset your settings.' });
    } finally {
      setIsResetting(false);
    }
  }

  const busy = isSaving || isResetting || isLoading;

  return (
    <div id="ai-settings-editor" className="mt-6 pt-6 border-t border-zinc-800 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-white">Business &amp; Assistant Settings</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          {isDeployed
            ? 'Changes are synced to your live AI receptionist when you save.'
            : 'Saved settings are used when you deploy your AI receptionist.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="settings-business-name" className="block text-xs font-semibold text-zinc-400 mb-1.5">
            Business Name
          </label>
          <div className="relative">
            <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              id="settings-business-name"
              type="text"
              maxLength={120}
              value={form.businessName}
              onChange={(e) => update('businessName', e.target.value)}
              disabled={busy}
              placeholder="Ridgeline Plumbing Co."
              className={`${FIELD} pl-10`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="settings-industry" className="block text-xs font-semibold text-zinc-400 mb-1.5">
            Business Type
          </label>
          <select
            id="settings-industry"
            value={form.industry}
            onChange={(e) => update('industry', e.target.value)}
            disabled={busy}
            className={`${FIELD} cursor-pointer`}
          >
            <option value="">Select your trade…</option>
            {INDUSTRY_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="settings-business-address" className="block text-xs font-semibold text-zinc-400 mb-1.5">
          Business Street Address <span className="text-zinc-600 font-normal">(optional)</span>
        </label>
        <div className="relative">
          <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            id="settings-business-address"
            type="text"
            maxLength={300}
            value={form.businessAddress}
            onChange={(e) => update('businessAddress', e.target.value)}
            disabled={busy}
            placeholder="123 Main St, Springfield, IL 62701"
            className={`${FIELD} pl-10`}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Used when callers choose an in-person appointment; leave blank if you only do callbacks or on-site visits at
          the customer&rsquo;s address.
        </p>
      </div>

      <div>
        <label htmlFor="settings-system-prompt" className="block text-xs font-semibold text-zinc-400 mb-1.5">
          AI Receptionist Prompt
        </label>
        <textarea
          id="settings-system-prompt"
          rows={8}
          maxLength={20000}
          value={form.systemPrompt}
          onChange={(e) => update('systemPrompt', e.target.value)}
          disabled={busy}
          placeholder="Leave blank to auto-generate a prompt from your business details."
          className={`${FIELD} text-xs leading-relaxed font-mono`}
        />
      </div>

      {message && (
        <div
          id="ai-settings-message"
          className={`p-3 rounded-lg text-xs flex items-start gap-2 border ${
            message.kind === 'ok'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-red-950/50 border-red-800/80 text-red-200'
          }`}
        >
          {message.kind === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <CircleAlert className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          id="ai-settings-save-button"
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold px-6 py-3 rounded-lg shadow-lg shadow-amber-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isSaving ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          id="ai-settings-reset-button"
          type="button"
          onClick={handleReset}
          disabled={busy}
          className="min-h-[44px] flex items-center justify-center gap-2 border border-red-900/70 hover:border-red-700 text-red-300 font-semibold px-6 py-3 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
          {isResetting ? 'Resetting…' : 'Clear / Reset All'}
        </button>
      </div>
    </div>
  );
}

