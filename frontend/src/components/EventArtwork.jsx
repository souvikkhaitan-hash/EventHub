import React from "react";

export default function EventArtwork({
  category = "technical",
  className = "",
}) {
  const common = {
    width: 112,
    height: 112,
    viewBox: "0 0 120 120",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 3.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  function renderArtwork() {
    switch (category) {
      case "technical":
        return (
          <svg {...common}>
            <rect
              x="20"
              y="20"
              width="80"
              height="59"
              rx="7"
              transform="rotate(-4 60 50)"
            />

            <path d="M46 39 L34 50 L46 61" />
            <path d="M74 39 L86 50 L74 61" />
            <path d="M65 34 L55 66" />

            <path d="M17 91 H103 L94 99 H26 Z" />
          </svg>
        );

      case "cultural":
        return (
          <svg {...common}>
            <path d="M47 26 V79" />
            <path d="M47 26 L85 18 V70" />

            <ellipse
              cx="33"
              cy="83"
              rx="15"
              ry="10"
              transform="rotate(-20 33 83)"
            />

            <ellipse
              cx="71"
              cy="74"
              rx="15"
              ry="10"
              transform="rotate(-20 71 74)"
            />

            <path d="M47 39 L85 31" />
            <path d="M94 35 L99 45 L109 50 L99 55 L94 65 L89 55 L79 50 L89 45 Z" />
          </svg>
        );

      case "workshop":
        return (
          <svg {...common}>
            <path d="M60 30 C46 22 31 23 18 29 V88 C33 82 46 83 60 91" />

            <path d="M60 30 C74 22 89 23 102 29 V88 C87 82 74 83 60 91" />

            <path d="M60 30 V91" />

            <path d="M29 44 C39 41 47 43 53 47" />
            <path d="M67 47 C74 43 82 41 91 44" />

            <path d="M29 57 C39 54 47 56 53 60" />
            <path d="M67 60 C74 56 82 54 91 57" />
          </svg>
        );

      case "seminar":
        return (
          <svg {...common}>
            <rect
              x="45"
              y="17"
              width="30"
              height="58"
              rx="15"
            />

            <path d="M32 56 C32 95 88 95 88 56" />
            <path d="M60 89 V103" />
            <path d="M43 103 H77" />

            <path d="M53 30 H67" />
            <path d="M53 40 H67" />
          </svg>
        );

      case "sports":
        return (
          <svg {...common}>
            <path d="M38 22 H82 V48 C82 71 69 82 60 82 C51 82 38 71 38 48 Z" />

            <path d="M38 30 H20 V42 C20 59 29 65 42 65" />
            <path d="M82 30 H100 V42 C100 59 91 65 78 65" />

            <path d="M60 82 V97" />
            <path d="M43 102 H77" />
            <path d="M60 36 L64 46 L75 47 L67 55 L69 66 L60 60 L51 66 L53 55 L45 47 L56 46 Z" />
          </svg>
        );

      default:
        return (
          <svg {...common}>
            <circle cx="60" cy="60" r="32" />
            <path d="M60 20 V100" />
            <path d="M20 60 H100" />
            <path d="M32 32 L88 88" />
            <path d="M88 32 L32 88" />
          </svg>
        );
    }
  }

  return (
    <span
      className={`event-artwork-icon ${className}`}
      aria-hidden="true"
    >
      {renderArtwork()}
    </span>
  );
}