import StandingsList from "./StandingsList";
import { loadLeagueData } from "@/lib/adapters/league";

export default async function LeaguePage({ params }: { params: { id: string } }) {
  const { table, opponentByTeam } = await loadLeagueData(params.id);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">League #{params.id}</h1>

      {table.length === 0 ? (
        <p>No standings available.</p>
      ) : (
        <StandingsList table={table} opponentByTeam={opponentByTeam} />
      )}
    </div>
  );
}
