// ============================================================
// EVENTHUB — DYNAMIC EVENT ARTWORK
// ============================================================

// Determine an event's artwork using its title
// and category.
//
// More specific event types are checked first.
// The event category is used as a fallback.

function getEventArtworkType(event) {
  const title = String(event?.title || "").toLowerCase();

  const category = String(
    event?.category || ""
  ).toLowerCase();

  if (
    title.includes("hackathon") ||
    title.includes("innovation challenge") ||
    title.includes("sih")
  ) {
    return "hackathon";
  }

  if (
    title.includes("cyber") ||
    title.includes("security") ||
    title.includes("ctf")
  ) {
    return "security";
  }

  if (
    title.includes("artificial intelligence") ||
    title.includes("machine learning") ||
    title.includes(" ai ") ||
    title.startsWith("ai ") ||
    title.includes(" ml ")
  ) {
    return "ai";
  }

  if (
    title.includes("code") ||
    title.includes("coding") ||
    title.includes("programming") ||
    title.includes("web development") ||
    title.includes("developer")
  ) {
    return "coding";
  }

  if (
    title.includes("music") ||
    title.includes("concert") ||
    title.includes("singing") ||
    title.includes("dance") ||
    title.includes("festival")
  ) {
    return "music";
  }

  if (
    title.includes("football") ||
    title.includes("cricket") ||
    title.includes("basketball") ||
    title.includes("tournament")
  ) {
    return "sports";
  }

  if (category === "technical") {
    return "coding";
  }

  if (category === "workshop") {
    return "workshop";
  }

  if (category === "cultural") {
    return "music";
  }

  if (category === "sports") {
    return "sports";
  }

  if (category === "seminar") {
    return "seminar";
  }

  return "general";
}


// ============================================================
// SVG ARTWORK COMPONENT
// ============================================================

export default function EventArtworkIcon({
  event,
  className = "",
}) {
  const type = getEventArtworkType(event);

  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  return (
    <svg
      viewBox="0 0 120 120"
      className={`event-artwork-icon ${className}`}
      aria-hidden="true"
      focusable="false"
      {...common}
    >

      {/* HACKATHON — TROPHY */}

      {type === "hackathon" && (
        <>
          <path d="M38 24H82V49C82 65 72 75 60 75S38 65 38 49V24Z" />

          <path d="M38 33H24V43C24 54 30 60 41 61" />

          <path d="M82 33H96V43C96 54 90 60 79 61" />

          <path d="M60 75V88" />

          <path d="M45 90H75" />

          <path d="M39 99H81" />

          <path
            d="M65 35L51 55H61L56 67L73 46H62L65 35Z"
            fill="currentColor"
            stroke="none"
          />
        </>
      )}

      {/* CODING — LAPTOP */}

      {type === "coding" && (
        <>
          <rect
            x="20"
            y="25"
            width="80"
            height="57"
            rx="7"
          />

          <path d="M12 91H108L101 100H19L12 91Z" />

          <path d="M51 44L39 54L51 64" />

          <path d="M69 44L81 54L69 64" />

          <path d="M65 39L55 69" />
        </>
      )}

      {/* CYBERSECURITY — SHIELD */}

      {type === "security" && (
        <>
          <path d="M60 14L97 29V57C97 79 83 94 60 106C37 94 23 79 23 57V29L60 14Z" />

          <rect
            x="44"
            y="52"
            width="32"
            height="27"
            rx="5"
          />

          <path d="M51 52V44C51 32 69 32 69 44V52" />

          <circle
            cx="60"
            cy="65"
            r="2"
            fill="currentColor"
          />
        </>
      )}

      {/* AI — NEURAL NETWORK */}

      {type === "ai" && (
        <>
          <path d="M28 30L60 19L92 37L84 77L55 99L24 76Z" />

          <path d="M28 30L55 55L92 37" />

          <path d="M55 55L84 77L55 99" />

          <path d="M24 76L55 55L60 19" />

          <path d="M92 37L84 77" />

          {[
            [28, 30],
            [60, 19],
            [92, 37],
            [84, 77],
            [55, 99],
            [24, 76],
            [55, 55],
          ].map(([cx, cy], index) => (
            <circle
              key={index}
              cx={cx}
              cy={cy}
              r="6"
              fill="currentColor"
              stroke="none"
            />
          ))}
        </>
      )}

      {/* WORKSHOP — TOOLS */}

      {type === "workshop" && (
        <>
          <path d="M29 25L42 38" />

          <path d="M40 18L54 32L47 39L33 25Z" />

          <path d="M46 42L87 83" />

          <path d="M81 77L91 87" />

          <path d="M80 23C69 26 65 37 70 46L32 84C23 93 36 106 45 97L83 59C92 64 103 57 104 46L91 52L81 42L87 29Z" />
        </>
      )}

      {/* CULTURE — MUSIC */}

      {type === "music" && (
        <>
          <path d="M48 78V30L91 20V68" />

          <path d="M48 43L91 33" />

          <ellipse
            cx="35"
            cy="82"
            rx="13"
            ry="9"
            transform="rotate(-20 35 82)"
          />

          <ellipse
            cx="78"
            cy="72"
            rx="13"
            ry="9"
            transform="rotate(-20 78 72)"
          />

          <path d="M22 33L29 25" />

          <path d="M96 91L103 83" />
        </>
      )}

      {/* SPORTS — BALL */}

      {type === "sports" && (
        <>
          <circle cx="60" cy="60" r="43" />

          <path d="M60 36L80 50L73 75H47L40 50L60 36Z" />

          <path d="M60 36V17" />

          <path d="M80 50L101 44" />

          <path d="M73 75L86 94" />

          <path d="M47 75L34 94" />

          <path d="M40 50L19 44" />
        </>
      )}

      {/* SEMINAR — MICROPHONE */}

      {type === "seminar" && (
        <>
          <rect
            x="44"
            y="18"
            width="32"
            height="55"
            rx="16"
          />

          <path d="M30 53C30 72 42 86 60 86S90 72 90 53" />

          <path d="M60 86V102" />

          <path d="M42 102H78" />
        </>
      )}

      {/* GENERAL — EVENT TICKET */}

      {type === "general" && (
        <>
          <path d="M18 35H102V49C92 49 92 71 102 71V85H18V71C28 71 28 49 18 49V35Z" />

          <path
            d="M60 35V85"
            strokeDasharray="5 6"
          />

          <path d="M40 48L45 59L40 70" />
        </>
      )}

    </svg>
  );
}