import { NextRequest, NextResponse } from "next/server";
import {
  isServiceAuthenticated,
  serviceAuthConfigured,
} from "@/app/lib/service-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const configured = serviceAuthConfigured();
  return NextResponse.json(
    {
      configured,
      authenticated: configured ? await isServiceAuthenticated(request) : false,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
