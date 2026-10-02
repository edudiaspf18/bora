import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/server/security/csp";
import { effectiveHost, resolveHost, segmentFor } from "@/server/tenancy/host";

// Só assets do Next ficam fora; paths pontuados passam pelo guard e pelo CSP.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const STATIC_FILE_RE = /\.[a-z0-9]+$/i;

function isInternalPath(rawPathname: string): boolean {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return true; // encoding malformado: trata como inválido (404)
  }
  pathname = pathname.replace(/\/+/g, "/").toLowerCase();
  return (
    pathname === "/panel" ||
    pathname.startsWith("/panel/") ||
    pathname === "/s" ||
    pathname.startsWith("/s/")
  );
}

function notFound(csp: string): NextResponse {
  const res = new NextResponse("Não encontrado", { status: 404 });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost";
  const hostHeader = effectiveHost(
    req.headers.get("host"),
    req.headers.get("x-forwarded-host"),
    rootDomain,
  );
  const target = resolveHost(hostHeader, rootDomain);
  const { pathname } = req.nextUrl;

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  if (target.kind === "unknown" || isInternalPath(pathname)) return notFound(csp);

  let res: NextResponse;
  if (target.kind === "landing" || STATIC_FILE_RE.test(pathname)) {
    res = NextResponse.next({ request: { headers } });
  } else {
    const url = req.nextUrl.clone();
    const rest = pathname === "/" ? "" : pathname;
    url.pathname =
      target.kind === "panel" ? `/panel${rest}` : `/s/${segmentFor(target)}${rest}`;
    res = NextResponse.rewrite(url, { request: { headers } });
  }
  res.headers.set("Content-Security-Policy", csp);
  return res;
}
