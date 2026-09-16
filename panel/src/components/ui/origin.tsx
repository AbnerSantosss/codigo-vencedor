import { Globe, Search, Mail } from 'lucide-react';
import { siMeta, siFacebook, siInstagram, siGoogle, siYoutube, siTiktok, siX, siWhatsapp, siKuaishou, type SimpleIcon } from 'simple-icons';
import { cn } from '@/lib/cn';

function BrandIcon({ icon }: { icon: SimpleIcon }) { return <svg viewBox="0 0 24 24" fill="currentColor"><path d={icon.path} /></svg>; }

export function identifyOrigin(source?: string | null) {
  const raw = source?.trim() || '';
  const value = raw.toLowerCase();
  const parts = value.split(/[^a-z0-9]+/);
  const has = (...names: string[]) => names.some(n => parts.includes(n));
  if (has('instagram', 'ig') && has('facebook', 'fb')) return { key: 'meta', label: 'Meta' };
  if (has('instagram', 'ig', 'instagramads')) return { key: 'instagram', label: 'Meta · Instagram' };
  if (has('facebook', 'fb', 'facebookads')) return { key: 'facebook', label: 'Meta · Facebook' };
  if (has('meta', 'metaads')) return { key: 'meta', label: 'Meta' };
  if (has('youtube', 'yt')) return { key: 'youtube', label: 'Google · YouTube' };
  if (has('google', 'googleads', 'adwords')) return { key: 'google', label: 'Google' };
  if (has('tiktok', 'tt')) return { key: 'tiktok', label: 'TikTok' };
  if (has('twitter', 'x')) return { key: 'x', label: 'X' };
  if (has('whatsapp', 'wa')) return { key: 'whatsapp', label: 'WhatsApp' };
  if (has('email', 'newsletter')) return { key: 'email', label: 'E-mail' };
  if (has('kwai')) return { key: 'kwai', label: 'Kwai' };
  if (has('bing', 'microsoft')) return { key: 'bing', label: 'Microsoft · Bing' };
  if (!value || ['direto', 'direct', '(direct)'].includes(value)) return { key: 'direct', label: 'Direto / sem origem' };
  return { key: 'other', label: raw };
}

/* A cor da marca fica só no ícone e vem dos tokens semânticos: azul (`info`)
   para Meta/Facebook, rosa/vermelho (`danger`) para Instagram e YouTube.
   O texto segue em `ink-2` — o rótulo é o que comunica, não a cor. */
const corDoIcone: Record<string, string> = {
  meta: 'text-info',
  facebook: 'text-info',
  instagram: 'text-danger',
  youtube: 'text-danger',
  whatsapp: 'text-ok',
};

export function OriginBadge({ source }: { source?: string | null }) {
  const origin = identifyOrigin(source);
  return <span className="inline-flex max-w-full items-center gap-1.5 text-2xs leading-[1.4] text-ink-2" title={source ? `Origem registrada: ${source}` : 'Sem utm_source registrada'}>
    <span className={cn('inline-flex shrink-0 items-center gap-0.5 [&_svg]:size-4', corDoIcone[origin.key] ?? 'text-muted')} aria-hidden="true">
      {['meta', 'facebook', 'instagram'].includes(origin.key) ? <BrandIcon icon={siMeta} /> : null}
      {origin.key === 'facebook' ? <BrandIcon icon={siFacebook} /> : origin.key === 'instagram' ? <BrandIcon icon={siInstagram} /> :
        origin.key === 'google' ? <BrandIcon icon={siGoogle} /> : origin.key === 'youtube' ? <BrandIcon icon={siYoutube} /> :
          origin.key === 'tiktok' ? <BrandIcon icon={siTiktok} /> : origin.key === 'x' ? <BrandIcon icon={siX} /> :
            origin.key === 'bing' ? <Search /> : origin.key === 'kwai' ? <BrandIcon icon={siKuaishou} /> : origin.key === 'whatsapp' ? <BrandIcon icon={siWhatsapp} /> : origin.key === 'email' ? <Mail /> : origin.key !== 'meta' ? <Globe /> : null}
    </span><span className="[overflow-wrap:anywhere]">{origin.label}</span>
  </span>;
}
