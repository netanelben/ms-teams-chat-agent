import { chromium } from "playwright";
import axios from "axios";
import "dotenv/config";
import { runTeamsMonitor } from "./teams-monitor.js";

const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY;

async function getOrCreateSession() {
  const existingSessionId = process.env.ANCHOR_SESSION_ID;

  if (existingSessionId) {
    console.log(`📡 Connecting to existing session: ${existingSessionId}`);
    try {
      const res = await axios.get(
        `https://api.anchorbrowser.io/v1/sessions/${existingSessionId}`,
        { headers: { "anchor-api-key": ANCHOR_API_KEY } },
      );
      const sessionData = res.data.data || res.data;
      if (sessionData.status !== "running") {
        console.warn(
          `⚠️ Session status is "${sessionData.status}". Creating new session...`,
        );
      } else {
        const cdp_url = `wss://connect.anchorbrowser.io?apiKey=${ANCHOR_API_KEY}&sessionId=${existingSessionId}`;
        const live_view_url =
          sessionData.live_view_url || sessionData.liveViewUrl;
        console.log(`✅ Reconnected to session: ${existingSessionId}`);
        if (live_view_url) console.log(`   Live View: ${live_view_url}`);
        return { sessionId: existingSessionId, cdp_url };
      }
    } catch (err) {
      console.warn(
        `⚠️ Could not reconnect (${err.response?.status || err.message}). Creating new session...`,
      );
    }
  }

  const requestBody = {
    session: {
      initial_url: "https://teams.microsoft.com/v2/",
    },
    browser: {
      profile: {
        name: process.env.ANCHOR_PROFILE_ID || undefined,
        persist: true,
      },
    },
  };

  const sessionResponse = await axios.post(
    "https://api.anchorbrowser.io/v1/sessions",
    requestBody,
    {
      headers: {
        "anchor-api-key": ANCHOR_API_KEY,
        "Content-Type": "application/json",
      },
    },
  );

  const { id: sessionId, cdp_url, live_view_url } = sessionResponse.data.data;
  console.log(`✅ New session created: ${sessionId}`);
  console.log(`   💡 To reuse this session, add to .env:`);
  console.log(`   ANCHOR_SESSION_ID=${sessionId}`);
  if (live_view_url) console.log(`   Live View: ${live_view_url}`);
  return { sessionId, cdp_url };
}

async function main() {
  console.log("🚀 Initializing Anchor Browser Session...");

  try {
    const { cdp_url } = await getOrCreateSession();

    if (!cdp_url) {
      throw new Error("No CDP URL available. Cannot connect to browser.");
    }

    console.log(`🔌 Connecting to browser via CDP...`);
    const browser = await chromium.connectOverCDP(cdp_url);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());

    await runTeamsMonitor(page);
  } catch (error) {
    console.error("🔴 Fatal error:", error.message);
    process.exit(1);
  }
}

main();
