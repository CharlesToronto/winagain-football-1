type Props = {
  onClick: () => void;
  className?: string;
};

export default function AiPromptButton({ onClick, className }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] text-white/60 hover:text-white/90 transition ${className ?? ""}`}
    >
      Charly, what do you think ?
    </button>
  );
}
