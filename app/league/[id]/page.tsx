import { loadLeagueData } from "@/lib/adapters/league";
import LeagueTabs from "./LeagueTabs";

export default async function LeaguePage({ params }: { params: { id: string } }) {
  const { table, opponentByTeam } = await loadLeagueData(params.id);

  return (
    <div className="p-6">
      <LeagueTabs leagueId={params.id} table={table} opponentByTeam={opponentByTeam} />
    </div>
  );
}
