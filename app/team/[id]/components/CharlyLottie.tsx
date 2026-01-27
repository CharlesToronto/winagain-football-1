import Lottie from "lottie-react";
import animationData from "./CharlyLottie.json";

export default function CharlyLottie({
  className,
}: {
  className?: string;
}) {
  return (
    <Lottie
      animationData={animationData}
      loop
      autoplay
      className={className}
      rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
      aria-hidden
    />
  );
}
