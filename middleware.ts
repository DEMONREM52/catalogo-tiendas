import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Proteger dashboard
  if (pathname.startsWith("/dashboard")) {
    // Supabase guarda sesión en localStorage en el navegador,
    // así que middleware no la ve. Por eso haremos protección simple:
    // redirigir si no hay cookie custom (la crearemos al login).
    const session = req.cookies.get("app_session")?.value;

    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      // Al entrar (o retomar la sesión) vuelve a esta sección del panel.
      url.search = pathname === "/dashboard" ? "" : `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
