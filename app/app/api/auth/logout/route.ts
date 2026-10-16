import { NextRequest, NextResponse } from "next/server";
import {
  clearServiceSessionCookie,
  requestIsSecure,
} from "@/app/lib/service-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return NextResponse.json(
    { authenticated: false },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Set-Cookie": clearServiceSessionCookie(requestIsSecure(request)),
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
