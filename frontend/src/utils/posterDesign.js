import { wrapPosterText } from "./eventPoster";

const kinds = [
  "headline",
  "tagline",
  "host",
  "details",
  "text",
  "qr",
];

const validColour = (value) =>
  typeof value === "string" &&
  /^#[0-9a-f]{6}$/i.test(value);

const inRange = (value, minimum, maximum) =>
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum;

export function newDesign(dark = false) {
  const ink = dark ? "#ffffff" : "#19233b";

  return {
    version: 1,
    format: "feed",
    background: dark ? "#17213a" : "#fbfbf7",
    accent: dark ? "#ddff82" : "#3854f5",
    overlay: 70,

    blocks: [
      {
        id: "title",
        kind: "headline",
        x: 7,
        y: 18,
        w: 86,
        h: 23,
        size: 88,
        colour: ink,
        visible: true,
      },
      {
        id: "invitation",
        kind: "tagline",
        x: 7,
        y: 43,
        w: 86,
        h: 10,
        size: 30,
        colour: ink,
        visible: true,
      },
      {
        id: "host",
        kind: "host",
        x: 7,
        y: 57,
        w: 86,
        h: 7,
        size: 26,
        colour: ink,
        visible: true,
      },
      {
        id: "details",
        kind: "details",
        x: 7,
        y: 76,
        w: 59,
        h: 17,
        size: 28,
        colour: ink,
        visible: true,
      },
      {
        id: "qr",
        kind: "qr",
        x: 73,
        y: 76,
        w: 21,
        h: 18,
        size: 28,
        colour: ink,
        visible: true,
      },
    ],
  };
}

export function validateDesign(data) {
  if (
    !data ||
    data.version !== 1 ||
    !["feed", "story"].includes(data.format) ||
    !validColour(data.background) ||
    !validColour(data.accent) ||
    !inRange(data.overlay, 0, 100) ||
    !Array.isArray(data.blocks) ||
    data.blocks.length < 2 ||
    data.blocks.length > 16
  ) {
    throw new Error(
      "Choose an EventHub design JSON exported by this editor."
    );
  }

  const ids = new Set();
  const canvasHeight =
    data.format === "story" ? 1920 : 1350;

  const blocks = data.blocks.map((block) => {
    if (
      !block ||
      typeof block.id !== "string" ||
      !/^[\w-]{1,50}$/.test(block.id) ||
      ids.has(block.id) ||
      !kinds.includes(block.kind) ||
      !inRange(block.x, 0, 95) ||
      !inRange(block.y, 0, 93) ||
      !inRange(block.w, 5, 100) ||
      !inRange(block.h, 3, 90) ||
      block.x + block.w > 100 ||
      !inRange(block.size, 16, 140) ||
      !validColour(block.colour) ||
      typeof block.visible !== "boolean"
    ) {
      throw new Error(
        "This design contains an invalid block or position."
      );
    }

    const bottom =
      block.y +
      (
        block.kind === "qr"
          ? block.w * 1080 / canvasHeight
          : block.h
      );

    if (
      bottom > 94.01 ||
      (
        block.kind === "qr" &&
        (
          block.w < 18 ||
          block.w > 30 ||
          !block.visible
        )
      )
    ) {
      throw new Error(
        "Keep blocks above the footer and the QR between 18% and 30% wide."
      );
    }

    if (
      block.kind === "text" &&
      (
        typeof block.text !== "string" ||
        block.text.length > 300
      )
    ) {
      throw new Error(
        "Custom text must be under 300 characters."
      );
    }

    ids.add(block.id);

    return {
      id: block.id,
      kind: block.kind,
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
      size: block.size,
      colour: block.colour,
      visible: block.visible,

      ...(block.kind === "text"
        ? { text: block.text }
        : {}),
    };
  });

  if (
    blocks.filter((block) => block.kind === "qr").length !== 1 ||
    !blocks.some(
      (block) =>
        block.kind === "headline" &&
        block.visible
    )
  ) {
    throw new Error(
      "Keep one QR and a visible event headline in the design."
    );
  }

  return {
    version: 1,
    format: data.format,
    background: data.background,
    accent: data.accent,
    overlay: data.overlay,
    blocks,
  };
}

export function drawCustomPoster(
  canvas,
  qr,
  options,
  design
) {
  validateDesign(design);

  const {
    event,
    headline,
    tagline,
    host,
    cover,
    local,
    now = Date.now(),
  } = options;

  if (!headline.trim()) {
    throw new Error("Enter a headline.");
  }

  if (!qr) {
    throw new Error(
      "Preparing the event QR. Try again."
    );
  }

  canvas.width = 1080;
  canvas.height =
    design.format === "story" ? 1920 : 1350;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  ctx.fillStyle = design.background;
  ctx.fillRect(0, 0, width, height);

  if (cover) {
    const scale = Math.max(
      width / cover.width,
      height / cover.height
    );

    ctx.drawImage(
      cover,
      (width - cover.width * scale) / 2,
      (height - cover.height * scale) / 2,
      cover.width * scale,
      cover.height * scale
    );

    ctx.globalAlpha = design.overlay / 100;
    ctx.fillStyle = design.background;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  ctx.textBaseline = "top";
  ctx.fillStyle = design.accent;

  ctx.font = "700 30px Arial";
  ctx.fillText("EventHub", 72, 56);

  ctx.font = "700 20px Arial";
  ctx.fillText(
    String(
      event.category || "Campus event"
    ).toUpperCase(),
    72,
    106
  );

  const date = new Date(
    event.start_datetime
  ).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  const values = {
    headline,
    tagline,
    host: host ? `Hosted by ${host}` : "",
    details:
      `${date} IST\n\n` +
      (event.venue || "See event details"),
  };

  for (const block of design.blocks) {
    if (!block.visible) continue;

    const x = block.x * width / 100;
    const y = block.y * height / 100;
    const blockWidth = block.w * width / 100;

    if (block.kind === "qr") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(
        x,
        y,
        blockWidth,
        blockWidth
      );

      ctx.imageSmoothingEnabled = false;

      ctx.drawImage(
        qr,
        x + 8,
        y + 8,
        blockWidth - 16,
        blockWidth - 16
      );

      ctx.imageSmoothingEnabled = true;
      continue;
    }

    const text =
      block.kind === "text"
        ? block.text
        : values[block.kind];

    const blockHeight =
      block.h * height / 100;

    let lines = [];
    let size;

    for (
      size = block.size;
      size >= 16;
      size--
    ) {
      const weight =
        block.kind === "headline" ? 700 : 500;

      ctx.font =
        `${weight} ${size}px Arial`;

      lines = [];

      for (
        const paragraph of String(
          text || ""
        ).split("\n")
      ) {
        lines.push(
          ...(
            paragraph
              ? wrapPosterText(
                  ctx,
                  paragraph,
                  blockWidth
                )
              : [""]
          )
        );
      }

      if (
        lines.length * size * 1.2 <=
        blockHeight
      ) {
        break;
      }
    }

    if (size < 16) {
      throw new Error(
        `Give the ${block.kind} block more space or shorten its text.`
      );
    }

    ctx.fillStyle = block.colour;

    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        x,
        y + index * size * 1.2
      );
    });
  }

  const marker =
    event.status !== "published"
      ? `${String(event.status).toUpperCase()} PREVIEW`
      : new Date(
          event.end_datetime
        ).getTime() <= now
        ? "EVENT HAS ENDED"
        : local
          ? "LOCAL PREVIEW"
          : "SCAN FOR EVENT DETAILS";

  ctx.fillStyle = design.background;
  ctx.fillRect(
    0,
    height - 60,
    width,
    60
  );

  ctx.fillStyle = design.accent;
  ctx.font = "700 17px Arial";

  ctx.fillText(
    marker,
    72,
    height - 40
  );
}