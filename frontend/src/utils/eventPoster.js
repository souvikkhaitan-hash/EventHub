export function wrapPosterText(ctx, text, width) {
  const lines = [];
  let line = "";

  for (const word of String(text).trim().split(/\s+/)) {
    if (!word) continue;

    const candidate = line ? `${line} ${word}` : word;

    if (ctx.measureText(candidate).width <= width) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);
    line = "";

    for (const letter of word) {
      if (
        line &&
        ctx.measureText(line + letter).width > width
      ) {
        lines.push(line);
        line = "";
      }

      line += letter;
    }
  }

  if (line) lines.push(line);

  return lines;
}

function fit(
  ctx,
  text,
  width,
  height,
  maximum,
  minimum,
  weight = 700
) {
  for (
    let size = maximum;
    size >= minimum;
    size -= 2
  ) {
    ctx.font =
      `${weight} ${size}px Arial, sans-serif`;

    const lines = wrapPosterText(ctx, text, width);

    if (lines.length * size * 1.15 <= height) {
      return { lines, size };
    }
  }

  throw new Error(
    "Some text is too long. Shorten the headline or invitation."
  );
}

function textBlock(
  ctx,
  text,
  x,
  y,
  width,
  height,
  maximum,
  minimum,
  weight = 700
) {
  const fitted = fit(
    ctx,
    text,
    width,
    height,
    maximum,
    minimum,
    weight
  );

  fitted.lines.forEach((line, index) => {
    ctx.fillText(
      line,
      x,
      y + index * fitted.size * 1.15
    );
  });
}

export function drawEventPoster(
  canvas,
  qrCanvas,
  options
) {
  const {
    event,
    headline,
    tagline,
    host = "",
    format,
    palette,
    local,
    cover,
    now = Date.now(),
  } = options;

  if (!headline.trim()) {
    throw new Error("Enter a poster headline.");
  }

  const start = new Date(event.start_datetime);

  if (!Number.isFinite(start.getTime())) {
    throw new Error(
      "This event needs a valid start date."
    );
  }

  if (!qrCanvas) {
    throw new Error(
      "The event QR is not ready. Try again."
    );
  }

  const width = 1080;
  const height = format === "story" ? 1920 : 1350;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error(
      "Poster rendering is unavailable in this browser."
    );
  }

  const dark = palette === "dark";

  const ink = dark ? "#ffffff" : "#19233b";
  const muted = dark ? "#c2cce0" : "#64718a";
  const accent = dark ? "#ddff82" : "#3854f5";

  ctx.fillStyle = dark ? "#17213a" : "#fbfbf7";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";

  // Brand.
  ctx.fillStyle = accent;
  ctx.fillRect(72, 64, 12, 42);

  ctx.fillStyle = ink;
  ctx.font = "700 32px Arial, sans-serif";
  ctx.fillText("EventHub", 100, 66);

  ctx.fillStyle = muted;
  ctx.font = "700 16px Arial, sans-serif";
  ctx.fillText("CAMPUS EVENTS", 72, 130);

  // Category and headline.
  ctx.fillStyle = accent;
  ctx.font = "700 20px Arial, sans-serif";

  ctx.fillText(
    String(event.category || "Event").toUpperCase(),
    72,
    188
  );

  ctx.fillStyle = ink;

  const titleHeight =
    format === "story" ? 330 : 240;

  textBlock(
    ctx,
    headline,
    68,
    236,
    940,
    titleHeight,
    format === "story" ? 104 : 88,
    36
  );

  ctx.fillStyle = muted;

  textBlock(
    ctx,
    tagline,
    72,
    254 + titleHeight,
    936,
    90,
    28,
    18,
    400
  );

  // Optional photo or date artwork.
  const artY = format === "story" ? 740 : 620;
  const artH = format === "story" ? 650 : 280;

  if (cover) {
    const scale = Math.max(
      936 / cover.width,
      artH / cover.height
    );

    const cropW = 936 / scale;
    const cropH = artH / scale;

    ctx.drawImage(
      cover,
      (cover.width - cropW) / 2,
      (cover.height - cropH) / 2,
      cropW,
      cropH,
      72,
      artY,
      936,
      artH
    );
  } else {
    ctx.fillStyle = accent;
    ctx.fillRect(72, artY, 936, artH);

    ctx.fillStyle = dark ? "#17213a" : "#ffffff";

    ctx.font =
      `700 ${Math.min(artH - 50, 240)}px Arial, sans-serif`;

    ctx.fillText(
      start.toLocaleDateString("en-GB", {
        day: "2-digit",
        timeZone: "Asia/Kolkata",
      }),
      98,
      artY + 30
    );

    ctx.font = "700 34px Arial, sans-serif";

    ctx.fillText(
      start.toLocaleDateString("en-GB", {
        month: "long",
        timeZone: "Asia/Kolkata",
      }).toUpperCase(),
      465,
      artY + 48
    );

    ctx.font = "400 24px Arial, sans-serif";

    ctx.fillText(
      start.toLocaleDateString("en-GB", {
        weekday: "long",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }),
      465,
      artY + 100
    );

    ctx.font = "700 20px Arial, sans-serif";

    ctx.fillText(
      "YOUR NEXT CAMPUS EXPERIENCE",
      465,
      artY + 160
    );
  }

  // Optional organising body.
  ctx.fillStyle = muted;

  if (host.trim()) {
    ctx.font = "600 20px Arial, sans-serif";

    ctx.fillText(
      `HOSTED BY  ${host.trim()}`,
      72,
      artY + artH + 28
    );
  }

  // Saved event information.
  const detailsY = height - 340;

  ctx.fillStyle = dark ? "#24314d" : "#edf0f6";
  ctx.fillRect(72, detailsY, 936, 260);

  ctx.fillStyle = muted;
  ctx.font = "700 15px Arial, sans-serif";
  ctx.fillText("DATE & TIME · IST", 96, detailsY + 24);

  const date = start.toLocaleDateString("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  });

  const time = start.toLocaleTimeString("en-IN", {
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  ctx.fillStyle = ink;
  ctx.font = "700 27px Arial, sans-serif";

  ctx.fillText(
    `${date} · ${time}`,
    96,
    detailsY + 54
  );

  ctx.fillStyle = muted;
  ctx.font = "700 15px Arial, sans-serif";
  ctx.fillText("VENUE", 96, detailsY + 110);

  ctx.fillStyle = ink;

  textBlock(
    ctx,
    event.venue || "See event details",
    96,
    detailsY + 139,
    590,
    96,
    27,
    17,
    600
  );

  // Keep the QR on a plain white background.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(740, detailsY + 12, 244, 244);

  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(
    qrCanvas,
    746,
    detailsY + 18,
    232,
    232
  );

  // Export status.
  ctx.fillStyle = muted;
  ctx.font = "600 16px Arial, sans-serif";

  const marker =
    event.status !== "published"
      ? `${String(event.status).toUpperCase()} PREVIEW`
      : new Date(event.end_datetime).getTime() <= now
        ? "EVENT HAS ENDED"
        : local
          ? "LOCAL PREVIEW"
          : "SCAN TO VIEW EVENT";

  ctx.fillText(marker, 72, height - 44);

  ctx.textAlign = "right";
  ctx.fillText(
    "Show up. Stand out.",
    1008,
    height - 44
  );

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}