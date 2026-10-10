import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const rendererOrigin = 'screenstash://renderer';
export function trustedRendererUrl(value: string, developmentUrl?: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (developmentUrl) return url.origin === new URL(developmentUrl).origin;
    return (
      url.protocol === 'screenstash:' &&
      url.hostname === 'renderer' &&
      !url.port
    );
  } catch {
    return false;
  }
}
export function resolveRendererAsset(root: string, requestUrl: string) {
  const url = new URL(requestUrl);
  if (!trustedRendererUrl(requestUrl))
    throw new Error('Invalid renderer origin');
  const relative =
    decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (
    relative.includes('\\') ||
    relative.includes('\0') ||
    relative.includes(':')
  )
    throw new Error('Invalid asset path');
  const resolved = path.resolve(root, relative);
  const within = path.relative(root, resolved);
  if (within.startsWith('..') || path.isAbsolute(within))
    throw new Error('Asset escapes renderer directory');
  return resolved;
}
export function configuredHttpOrigin(value: string, development: boolean) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' &&
      !(development && loopback && url.protocol === 'http:')) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Invalid application service origin');
  return url.origin;
}
export function fileResponseUrl(assetPath: string) {
  // Kept separate from untrusted protocol URLs; only resolved contained assets reach Electron net.fetch.
  return pathToFileURL(assetPath).href;
}
