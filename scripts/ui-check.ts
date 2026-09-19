/** Drives the real UI in Chrome to check drawing + breakdown: pnpm exec tsx scripts/ui-check.ts */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const main = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--window-size=1440,900"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle0" });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const click = async (x: number, y: number) => {
    await page.mouse.click(x, y);
    await wait(80);
  };
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 });
    await page.mouse.up();
    await wait(80);
  };

  // draw a chain by clicking the newest vertex over and over
  const vertex = (index: number) =>
    page.evaluate((i) => {
      const svg = document.querySelector("[data-slot=molecule-canvas]")!;
      const circles = [...svg.querySelectorAll("circle[r='13']")] as SVGCircleElement[];
      const target = i < 0 ? circles[circles.length + i] : circles[i];
      const rect = svg.getBoundingClientRect();
      return {
        x: rect.left + Number(target.getAttribute("cx")),
        y: rect.top + Number(target.getAttribute("cy")),
      };
    }, index);

  await click(420, 460);
  for (let i = 0; i < 5; i++) {
    const tip = await vertex(-1);
    await click(tip.x, tip.y);
  }
  const heading = async () => page.$eval("h1", (el) => el.textContent);
  console.log("after clicks:", await heading());

  // branch: drag from the third vertex
  const third = await page.evaluate(() => {
    const svg = document.querySelector("[data-slot=molecule-canvas]")!;
    const circles = [...svg.querySelectorAll("circle[r='13']")];
    const target = circles[2] as SVGCircleElement;
    const rect = svg.getBoundingClientRect();
    return { x: rect.left + Number(target.getAttribute("cx")), y: rect.top + Number(target.getAttribute("cy")) };
  });
  await drag(third.x, third.y, third.x + 10, third.y - 60);
  console.log("after branch drag:", await heading());

  // double bond tool on the first bond
  await page.click('button[aria-label="Double bond"]');
  const bondMid = await page.evaluate(() => {
    const svg = document.querySelector("[data-slot=molecule-canvas]")!;
    const lines = [...svg.querySelectorAll("line")].filter((l) => !l.getAttribute("stroke-dasharray"));
    const l = lines[0];
    const rect = svg.getBoundingClientRect();
    return {
      x: rect.left + (Number(l.getAttribute("x1")) + Number(l.getAttribute("x2"))) / 2,
      y: rect.top + (Number(l.getAttribute("y1")) + Number(l.getAttribute("y2"))) / 2,
    };
  });
  await click(bondMid.x, bondMid.y);
  console.log("after double bond:", await heading());

  // open the breakdown and walk to the numbering step
  const buttons = await page.$$("button");
  for (const button of buttons) {
    const text = await button.evaluate((el) => el.textContent);
    if (text?.includes("Breakdown")) { await button.click(); break; }
  }
  await new Promise((r) => setTimeout(r, 200));
  const steps = await page.$$("aside ol button");
  console.log("steps:", steps.length);
  if (steps[1]) await steps[1].click();
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: "/tmp/ui-draw.png" });

  const stepTitles = await page.$$eval("aside ol button", (els) => els.map((e) => e.textContent?.slice(0, 60)));
  console.log(stepTitles.join("\n"));

  await browser.close();
};

main();
