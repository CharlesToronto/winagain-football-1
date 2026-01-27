import Card from "@/app/components/ui/Card";
import OddsConverter from "./components/OddsConverter";
import { loadHomeCounts } from "@/lib/adapters/home";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { fixturesToday, leagues, teams, teamStats, odds, topLeaguesToday } =
    await loadHomeCounts();
  const cardClass = "bg-white/10 border-white/10 backdrop-blur-md text-white";

  return (
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 text-white">

      <Card className={cardClass}>
        <h2 className="text-lg font-semibold mb-1">Matches Today</h2>
        <p className="text-3xl font-bold">{fixturesToday || 0}</p>
        <p className="text-white/70 text-sm">Total fixtures scheduled today</p>
      </Card>

      {topLeaguesToday.map((league) => (
        <Card key={league.id} className={cardClass}>
          <h2 className="text-lg font-semibold mb-1">{league.name}</h2>
          <p className="text-3xl font-bold">{league.count}</p>
          <p className="text-white/70 text-sm">Matchs du jour</p>
        </Card>
      ))}

      <Card className={cardClass}>
        <h2 className="text-lg font-semibold mb-1">Active Leagues</h2>
        <p className="text-3xl font-bold">{leagues || 0}</p>
        <p className="text-white/70 text-sm">Total competitions available</p>
      </Card>

      <Card className={cardClass}>
        <h2 className="text-lg font-semibold mb-1">Teams Imported</h2>
        <p className="text-3xl font-bold">{teams || 0}</p>
        <p className="text-white/70 text-sm">Teams from all leagues</p>
      </Card>

      <Card className={cardClass}>
        <h2 className="text-lg font-semibold mb-1">Teams With Stats</h2>
        <p className="text-3xl font-bold">{teamStats || 0}</p>
        <p className="text-white/70 text-sm">Teams having advanced stats</p>
      </Card>

      <Card className={cardClass}>
        <h2 className="text-lg font-semibold mb-1">Odds Imported</h2>
        <p className="text-3xl font-bold">{odds || 0}</p>
        <p className="text-white/70 text-sm">Fixtures with bookmaker info</p>
      </Card>

      <Card className={`${cardClass} md:col-span-2 xl:col-span-3`}>
        <OddsConverter />
      </Card>

      <Card className={cardClass}>
        <h2 className="text-lg font-semibold mb-2">Quick Actions</h2>
        <div className="flex flex-col gap-2">
          <a href="/leagues" className="text-white/80 hover:text-white hover:underline">
            → View Leagues
          </a>
          <a href="/search" className="text-white/80 hover:text-white hover:underline">
            → Search Matches
          </a>
          <a href="/teams" className="text-white/80 hover:text-white hover:underline">
            → Team Statistics
          </a>
        </div>
      </Card>

    </div>
  );
}
