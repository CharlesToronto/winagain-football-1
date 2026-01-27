import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("competitions")
      .select("*")
      .order("country", { ascending: true })
      .order("priority", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("❌ Supabase error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("❌ ERROR /api/competitions:", e);
    return NextResponse.json({ error: "Failed to load competitions" }, { status: 500 });
  }
}
