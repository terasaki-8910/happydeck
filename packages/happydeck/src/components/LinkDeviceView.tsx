import { encodeBase64, pollAccountLink, startAccountLink } from 'happy-client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useHappyStore } from '../store/happyStore';
import { setStoredCredentials } from '../lib/tauri';
import { useT } from '../lib/i18n';

type LinkState = { phase: 'generating' } | { phase: 'waiting'; qrDataUrl: string } | { phase: 'error'; message: string } | { phase: 'saving' };

/**
 * In-app QR device-link flow — so linking a fresh install never requires
 * dropping to the terminal (`pnpm --filter happy-client run link`), which
 * doesn't exist once this ships as a signed .app the user just downloads.
 */
export function LinkDeviceView() {
  const t = useT();
  const [state, setState] = useState<LinkState>({ phase: 'generating' });
  const [attemptId, setAttemptId] = useState(0);
  const bootstrap = useHappyStore((s) => s.bootstrap);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setState({ phase: 'generating' });
      const attempt = await startAccountLink();
      if (cancelled) return;
      // Transparent background so the card's own --bg-tile shows through
      // (see .link-device-qr) — the dot color has to match --text at
      // generation time since QRCode.toDataURL rasterizes a PNG once, not a
      // live-updating SVG that could reference the CSS variable directly.
      const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e7e7ea';
      const qrDataUrl = await QRCode.toDataURL(attempt.qrUrl, { margin: 1, width: 240, color: { dark: textColor, light: '#00000000' } });
      if (cancelled) return;
      setState({ phase: 'waiting', qrDataUrl });

      try {
        const result = await pollAccountLink(attempt);
        if (cancelled) return;
        setState({ phase: 'saving' });
        await setStoredCredentials({
          schemaVersion: 1,
          token: result.token,
          secret: encodeBase64(result.secret, 'base64url'),
        });
        if (cancelled) return;
        await bootstrap();
      } catch (error) {
        if (cancelled) return;
        setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [attemptId, bootstrap]);

  return (
    <div className="link-device">
      <h2>{t('linkDeviceTitle')}</h2>
      <p className="settings-hint">{t('linkDeviceHint')}</p>

      {state.phase === 'generating' && <p className="app-message">{t('linkDeviceGenerating')}</p>}

      {state.phase === 'waiting' && (
        <>
          <img className="link-device-qr" src={state.qrDataUrl} alt={t('linkDeviceQrAlt')} />
          <p className="settings-hint">{t('linkDeviceWaiting')}</p>
        </>
      )}

      {state.phase === 'saving' && <p className="app-message">{t('linkDeviceSaving')}</p>}

      {state.phase === 'error' && (
        <>
          <p className="app-message app-message-error">{state.message}</p>
          <button type="button" onClick={() => setAttemptId((n) => n + 1)}>
            {t('linkDeviceRetryQr')}
          </button>
        </>
      )}
    </div>
  );
}
