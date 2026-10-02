const RESERVED = new Set(["app", "www", "api", "admin", "static"]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export type HostTarget =
  | { kind: "landing" }
  | { kind: "panel" }
  | { kind: "store"; slug: string }
  | { kind: "custom"; host: string }
  | { kind: "unknown" };

export function normalizeHost(raw: string | null): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  if (host.startsWith("[")) return null;
  host = host.replace(/:\d{1,5}$/, "").replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) return null;
  return host;
}

export function resolveHost(raw: string | null, rootDomain: string): HostTarget {
  const host = normalizeHost(raw);
  if (!host) return { kind: "unknown" };
  const root = rootDomain.toLowerCase();

  if (host === root || host === `www.${root}`) return { kind: "landing" };
  if (host === `app.${root}`) return { kind: "panel" };

  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1));
    if (label.includes(".") || RESERVED.has(label) || !SLUG_RE.test(label)) {
      return { kind: "unknown" };
    }
    return { kind: "store", slug: label };
  }
  return { kind: "custom", host };
}

export function segmentFor(target: HostTarget): string | null {
  if (target.kind === "store") return target.slug;
  if (target.kind === "custom") return target.host;
  return null;
}

const LOOPBACK_RE = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

// O fetch interno de redirect() das Server Actions chega com Host=loopback e o host
// real em x-forwarded-host. Só confiamos nele quando o Host é loopback E o domínio
// raiz é local; qualquer outro caso usa o Host (x-forwarded-host é controlado pelo cliente).
export function effectiveHost(
  hostHeader: string | null,
  forwardedHost: string | null,
  rootDomain: string,
): string | null {
  const root = rootDomain.toLowerCase();
  const localRoot = root === "localhost" || root.endsWith(".localhost");
  if (!localRoot || !hostHeader || !LOOPBACK_RE.test(hostHeader.trim())) return hostHeader;
  const forwarded = forwardedHost?.split(",")[0]?.trim() ?? null;
  return normalizeHost(forwarded) ? forwarded : hostHeader;
}
