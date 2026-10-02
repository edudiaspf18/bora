import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/server/security/csp";
import { resolveHost, segmentFor } from "@/server/tenancy/host";

// Arquivos com extensão (public/) e assets do Next não passam pelo middleware.
export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};

function isInternalPath(pathname: string): boolean {
  return (
    pathname === "/panel" ||
    pathname.startsWith("/panel/") ||
    pathname === "/s" ||
    pathname.startsWith("/s/")
  );
}

function notFound(csp: string): NextResponse {
  const res = new NextResponse("Not found", { status: 404 });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost";
  const target = resolveHost(req.headers.get("host"), rootDomain);
  const { pathname } = req.nextUrl;

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  if (target.kind === "unknown" || isInternalPath(pathname)) return notFound(csp);

  let res: NextResponse;
  if (target.kind === "landing") {
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
