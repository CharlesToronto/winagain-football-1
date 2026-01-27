import { NextResponse } from "next/server";
import { apiFootball } from "@/lib/apiFootball";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// On garde ce tableau synchronisé avec /api/competitions
const GLOBAL_COMPETITIONS = [
  1, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15, 16, 17, 19, 20, 848, 528
];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");

    if (!date) {
      return NextResponse.json({ error: "Missing date" }, { status: 400 });
    }

    // On récupère les compétitions filtrées par /api/competitions
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const allowedRes = await fetch(`${baseUrl}/api/competitions`);
    const allowed = await allowedRes.json();
    const allowedIds = allowed.map((l: any) => l.id);

    // On ajoute FORCÉMENT les compétitions globales
    const finalAllowed = new Set([...allowedIds, ...GLOBAL_COMPETITIONS]);

    // Récupérer les fixtures du jour
    const data = await apiFootball(`fixtures?date=${date}`);
    const fixtures = data?.response ?? [];

    // Ne garder QUE les fixtures autorisées
    const filtered = fixtures.filter((fx: any) => finalAllowed.has(fx.league.id));

    return NextResponse.json(filtered);
  } catch (e) {
    console.error("❌ FAILED /api/fixtures:", e);
    return NextResponse.json({ error: "Failed to load fixtures" }, { status: 500 });
  }
}
