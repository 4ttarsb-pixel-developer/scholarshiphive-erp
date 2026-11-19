// Social platform icons (from the open-source Simple Icons set, CC0) with each platform's colour.
import {
  siFacebook, siInstagram, siX, siYoutube, siTiktok, siWhatsapp, siTelegram, siSnapchat, siPinterest, siThreads,
  siGithub, siBehance, siDribbble, siMedium, siReddit, siDiscord, siUpwork, siFiverr, siQuora, siTwitch, siSpotify,
} from 'simple-icons';
import { Briefcase, Globe } from 'lucide-react';

export const PLATFORMS = {
  facebook: { label: 'Facebook', icon: siFacebook, placeholder: 'facebook.com/yourpage' },
  instagram: { label: 'Instagram', icon: siInstagram, placeholder: 'instagram.com/yourname' },
  linkedin: { label: 'LinkedIn', hex: '0A66C2', lucide: Briefcase, placeholder: 'linkedin.com/in/yourname' },
  x: { label: 'X (Twitter)', icon: siX, placeholder: 'x.com/yourname' },
  youtube: { label: 'YouTube', icon: siYoutube, placeholder: 'youtube.com/@yourchannel' },
  tiktok: { label: 'TikTok', icon: siTiktok, placeholder: 'tiktok.com/@yourname' },
  whatsapp: { label: 'WhatsApp', icon: siWhatsapp, placeholder: '+92 300 1234567 or wa.me/923001234567' },
  telegram: { label: 'Telegram', icon: siTelegram, placeholder: 't.me/yourname' },
  snapchat: { label: 'Snapchat', icon: siSnapchat, placeholder: 'snapchat.com/add/yourname', dark: true },
  pinterest: { label: 'Pinterest', icon: siPinterest, placeholder: 'pinterest.com/yourname' },
  threads: { label: 'Threads', icon: siThreads, placeholder: 'threads.net/@yourname' },
  github: { label: 'GitHub', icon: siGithub, placeholder: 'github.com/yourname' },
  behance: { label: 'Behance', icon: siBehance, placeholder: 'behance.net/yourname' },
  dribbble: { label: 'Dribbble', icon: siDribbble, placeholder: 'dribbble.com/yourname' },
  medium: { label: 'Medium', icon: siMedium, placeholder: 'medium.com/@yourname' },
  reddit: { label: 'Reddit', icon: siReddit, placeholder: 'reddit.com/user/yourname' },
  discord: { label: 'Discord', icon: siDiscord, placeholder: 'discord.gg/invite' },
  upwork: { label: 'Upwork', icon: siUpwork, placeholder: 'upwork.com/freelancers/…' },
  fiverr: { label: 'Fiverr', icon: siFiverr, placeholder: 'fiverr.com/yourname' },
  quora: { label: 'Quora', icon: siQuora, placeholder: 'quora.com/profile/yourname' },
  twitch: { label: 'Twitch', icon: siTwitch, placeholder: 'twitch.tv/yourname' },
  spotify: { label: 'Spotify', icon: siSpotify, placeholder: 'open.spotify.com/…' },
  website: { label: 'Website', hex: '64748B', lucide: Globe, placeholder: 'https://yourwebsite.com' },
};

const hexOf = p => `#${PLATFORMS[p]?.icon?.hex || PLATFORMS[p]?.hex || '64748B'}`;

/** Just the glyph, in the brand colour (or white on a coloured badge). */
export function SocialGlyph({ platform, size = 20, color }) {
  const p = PLATFORMS[platform];
  if (!p) return <Globe size={size} />;
  if (p.lucide) { const L = p.lucide; return <L size={size} color={color || hexOf(platform)} />; }
  return <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-hidden="true" fill={color || hexOf(platform)}><path d={p.icon.path} /></svg>;
}

/** Round coloured badge with the white glyph — used for the link row. */
export function SocialBadge({ platform, size = 42 }) {
  const p = PLATFORMS[platform];
  const bg = hexOf(platform);
  const fg = p?.dark ? '#111' : '#fff';
  const black = ['#000000', '#181717'].includes(bg);
  return (
    <span className="soc-badge" style={{ width: size, height: size, background: bg, boxShadow: black ? 'inset 0 0 0 1.5px rgba(255,255,255,.35)' : undefined, '--soc': bg }}>
      <SocialGlyph platform={platform} size={Math.round(size * 0.46)} color={fg} />
    </span>
  );
}
export const socialColor = hexOf;
