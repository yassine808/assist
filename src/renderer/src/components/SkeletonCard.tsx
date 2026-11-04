export default function SkeletonCard() {
  return (
    <div className="lobby-slot">
      <div className="lobby-card">
        <div className="lobby-frame animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="lobby-body" style={{ background: "#0f1923" }} />
        </div>
      </div>
      <div className="lobby-start" style={{ background: "rgba(255,255,255,0.06)", borderColor: "transparent" }} />
    </div>
  );
}
