/** One HTTP origin is used by auth and both Socket.IO game modes. */
export function backendOrigin(value: string | undefined, production: boolean): string {
    const raw = value?.trim();
    if (!raw && production) throw new Error('Set VITE_SERVER_URL to the public HTTPS backend origin before building.');
    const url = new URL(raw || 'http://localhost:3001');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('VITE_SERVER_URL must be an HTTP(S) origin without credentials, a path, query or fragment.');
    }
    if (production && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
        throw new Error('Production VITE_SERVER_URL must point to a public HTTPS backend.');
    }
    return url.origin;
}
