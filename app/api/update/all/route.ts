import { NextResponse } from "next/server";

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

const updatePaths = [
  "competitions",
  "teams",
  "fixtures",
  "team-stats",
  "stats",
  "odds",
];

export async function GET() {
  for (const path of updatePaths) {
    try {
      const response = await fetch(`${baseUrl}/api/update/${path}`);

      if (!response.ok) {
        let errorDetail: any = null;

        try {
          errorDetail = await response.json();
        } catch {
          errorDetail = await response.text();
        }

        return NextResponse.json(
          {
            success: false,
            step: path,
            status: response.status,
            error: errorDetail,
          },
          { status: response.status }
        );
      }
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          step: path,
          error: (error as Error)?.message ?? String(error),
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    updated: updatePaths,
  });
}
