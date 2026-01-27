export default function StatLine({ stat }: any) {
  if (!stat) return null;
  return (
    <div className="flex justify-between text-sm">
      <span>{stat.label}</span>
      <span className="flex gap-2">
        <span className="text-xs text-slate-400">
          ({stat.count}/{stat.total})
        </span>
        <span className="text-xs font-semibold text-emerald-400">
          {stat.percent}%
        </span>
      </span>
    </div>
  );
}
