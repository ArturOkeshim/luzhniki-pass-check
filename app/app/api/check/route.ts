import { NextRequest, NextResponse } from "next/server";
import { findPlateChecks } from "@/app/lib/subscriptions";
import { normalizePlateFragment } from "@/app/lib/plate";
import { isServiceAuthenticated } from "@/app/lib/service-auth";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!(await isServiceAuthenticated(request))) {
      return json({ error: "Требуется вход в сервис." }, 401);
    }
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return json({ error: "Некорректный запрос." }, 415);
    }
    const body = (await request.json()) as { query?: unknown };
    const query = normalizePlateFragment(body.query);
    const items = await findPlateChecks(query);
    return json({ found: items.length > 0, items });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Введите")) {
      return json({ error: error.message }, 400);
    }
    console.error("SUBSCRIPTION_CHECK_FAILED", error);
    return json({ error: "Сервис временно недоступен. Повторите проверку." }, 503);
  }
}
