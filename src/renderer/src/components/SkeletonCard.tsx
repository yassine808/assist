export default function SkeletonCard() {
  return (
    <div className="lobby-slot">
      <div className="lobby-card">
        <div className="lobby-inner animate-pulse">
          <div className="lobby-art-wrap" style={{ background: "rgba(255,255,255,0.07)" }} />
        </div>
      </div>
      <div className="lobby-start" style={{ background: "rgba(255,255,255,0.06)", borderColor: "transparent" }} />
    </div>
  );
}
