import { NextRequest, NextResponse } from "next/server";
import {
  createServiceSession,
  requestIsSecure,
  serviceSessionCookie,
  verifyServiceCredentials,
} from "@/app/lib/service-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json({ error: "Некорректный запрос." }, { status: 415 });
    }
    const body = (await request.json()) as { login?: unknown; password?: unknown };
    if (
      typeof body.login !== "string" ||
      typeof body.password !== "string" ||
      body.login.length > 128 ||
      body.password.length > 256
    ) {
      return NextResponse.json({ error: "Неверный логин или пароль." }, { status: 401 });
    }
    const verifiedLogin = await verifyServiceCredentials(body.login, body.password);
    if (!verifiedLogin) {
      return NextResponse.json({ error: "Неверный логин или пароль." }, { status: 401 });
    }
    const token = await createServiceSession(verifiedLogin);
    return NextResponse.json(
      { authenticated: true },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Set-Cookie": serviceSessionCookie(token, requestIsSecure(request)),
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    console.error("SERVICE_LOGIN_FAILED", error);
    return NextResponse.json(
      { error: "Авторизация сервиса не настроена." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
