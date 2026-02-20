const FIXTURE_REPORTS_TABLE = "app_fixture_update_reports";

type SupabaseLike = {
  from: (table: string) => any;
};

type FixtureUpdateReportInput = {
  jobName: string;
  source: string;
  status: "success" | "error";
  startedAt: string | Date;
  finishedAt?: string | Date;
  durationMs?: number;
  payload?: Record<string, any> | null;
  error?: string | null;
};

function isMissingTableError(error: any) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return (
    message.includes("does not exist") &&
    message.includes(`relation \"${FIXTURE_REPORTS_TABLE}\"`)
  );
}

function toIso(value: string | Date | undefined) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function resolveDurationMs(
  startedAtIso: string,
  finishedAtIso: string,
  explicitDurationMs?: number
) {
  if (typeof explicitDurationMs === "number" && Number.isFinite(explicitDurationMs)) {
    return Math.max(0, Math.round(explicitDurationMs));
  }
  const startedAt = new Date(startedAtIso).getTime();
  const finishedAt = new Date(finishedAtIso).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return 0;
  return Math.max(0, Math.round(finishedAt - startedAt));
}

export async function writeFixtureUpdateReport(
  supabase: SupabaseLike,
  input: FixtureUpdateReportInput
): Promise<void> {
  try {
    const startedAtIso = toIso(input.startedAt);
    const finishedAtIso = toIso(input.finishedAt);
    const durationMs = resolveDurationMs(startedAtIso, finishedAtIso, input.durationMs);

    const { error } = await supabase.from(FIXTURE_REPORTS_TABLE).insert({
      job_name: input.jobName,
      source: input.source,
      status: input.status,
      started_at: startedAtIso,
      finished_at: finishedAtIso,
      duration_ms: durationMs,
      payload: input.payload ?? null,
      error: input.error ?? null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      if (isMissingTableError(error)) return;
      console.error("[fixture-report] insert failed", error);
    }
  } catch (error) {
    console.error("[fixture-report] unexpected logging error", error);
  }
}
