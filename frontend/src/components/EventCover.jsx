import "../styles/event-covers.css";

const tiles = {
  technical: [0, 0],
  cultural: [1, 0],
  workshop: [2, 0],
  seminar: [0, 1],
  sports: [1, 1],
  community: [2, 1],
};

export default function EventCover({
  category,
  className = "",
  showLabel = false,
}) {
  const [column, row] = tiles[category] || tiles.community;

  return (
    <div
      className={`event-cover ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 300 200"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <image
          href="/images/eventhub-category-covers.webp"
          x={-column * 300}
          y={-row * 200}
          width="900"
          height="400"
        />
      </svg>

      {showLabel && (
        <span className="event-cover-label">
          Category cover
        </span>
      )}
    </div>
  );
}