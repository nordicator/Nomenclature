export type ShareResult = {
  seed: string;
  mode: string;
  difficulty: string;
  total: number;
  correct: number;
  ms: number;
  /** One entry per question: clean, hinted or given up. */
  marks: ("clean" | "hinted" | "missed")[];
  url: string;
};

export function formatTime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const MARK_EMOJI = { clean: "\u{1F7E9}", hinted: "\u{1F7E8}", missed: "\u{1F7E5}" };
const MARK_COLOR = { clean: "#16a34a", hinted: "#eab308", missed: "#dc2626" };

export function shareText(result: ShareResult): string {
  return [
    `Nomenclature · ${result.mode} · ${result.difficulty}`,
    `${result.correct}/${result.total} in ${formatTime(result.ms)}`,
    result.marks.map((mark) => MARK_EMOJI[mark]).join(""),
    `seed ${result.seed}`,
    result.url,
  ].join("\n");
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paints the little result card people can paste into a chat. */
export function drawResultCard(result: ShareResult): HTMLCanvasElement {
  const scale = 2;
  const width = 560;
  const height = 300;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#e4e4e7";
  ctx.lineWidth = 2;
  roundedRect(ctx, 1, 1, width - 2, height - 2, 18);
  ctx.stroke();

  const font = (size: number, weight = "400") =>
    `${weight} ${size}px ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial`;

  ctx.fillStyle = "#71717a";
  ctx.font = font(13, "600");
  ctx.fillText("NOMENCLATURE", 32, 46);

  ctx.fillStyle = "#18181b";
  ctx.font = font(52, "600");
  ctx.fillText(formatTime(result.ms), 32, 108);

  ctx.fillStyle = "#3f3f46";
  ctx.font = font(18);
  ctx.fillText(`${result.correct} of ${result.total} named right`, 32, 140);

  ctx.fillStyle = "#71717a";
  ctx.font = font(15);
  ctx.fillText(`${result.mode} · ${result.difficulty}`, 32, 166);

  const size = 26;
  const gap = 8;
  result.marks.forEach((mark, i) => {
    const columns = Math.floor((width - 64 + gap) / (size + gap));
    const x = 32 + (i % columns) * (size + gap);
    const y = 196 + Math.floor(i / columns) * (size + gap);
    ctx.fillStyle = MARK_COLOR[mark];
    roundedRect(ctx, x, y, size, size, 7);
    ctx.fill();
  });

  ctx.fillStyle = "#a1a1aa";
  ctx.font = font(13);
  ctx.fillText(`seed ${result.seed} · same link, same molecules`, 32, height - 26);

  return canvas;
}

export async function copyCardToClipboard(result: ShareResult): Promise<"copied" | "downloaded"> {
  const canvas = drawResultCard(result);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not render the card");
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  } catch {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nomenclature-${result.seed}.png`;
    link.click();
    URL.revokeObjectURL(url);
    return "downloaded";
  }
}
