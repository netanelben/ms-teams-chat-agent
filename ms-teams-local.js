import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import "dotenv/config";
import { runTeamsMonitor } from "./teams-monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR =
  process.env.TEAMS_USER_DATA_DIR ||
  path.join(__dirname, ".teams-browser-profile");

async function launchLocalBrowser() {
  console.log("🚀 Launching local browser...");
  console.log(`   Profile: ${USER_DATA_DIR}`);

  const launchOptions = {
    headless: false,
    viewport: null,
    args: ["--start-maximized"],
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      ...launchOptions,
      channel: "chrome",
    });
  } catch {
    console.log("   Chrome not found, falling back to bundled Chromium.");
    context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
  }

  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("🔴 OPENAI_API_KEY is required in .env");
    process.exit(1);
  }

  try {
    const { context, page } = await launchLocalBrowser();

    context.on("close", () => {
      console.log("Browser closed. Exiting.");
      process.exit(0);
    });

    await runTeamsMonitor(page);
  } catch (error) {
    console.error("🔴 Fatal error:", error.message);
    process.exit(1);
  }
}

main();
