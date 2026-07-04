import { chromium } from "playwright";
import axios from "axios";
import "dotenv/config";

const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY;
const TARGET_USER_NAME = "John Doe";

async function runTeamsTest() {
  console.log("🚀 Initializing Anchor Browser Session...");

  try {
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

    console.log("📡 POST https://api.anchorbrowser.io/v1/sessions");
    console.log("   Body:", JSON.stringify(requestBody, null, 2));
    console.log(
      "   anchor-api-key:",
      ANCHOR_API_KEY
        ? `${ANCHOR_API_KEY.slice(0, 6)}...${ANCHOR_API_KEY.slice(-4)}`
        : "⚠️ MISSING",
    );

    let sessionResponse;
    try {
      sessionResponse = await axios.post(
        "https://api.anchorbrowser.io/v1/sessions",
        requestBody,
        {
          headers: {
            "anchor-api-key": ANCHOR_API_KEY,
            "Content-Type": "application/json",
          },
        },
      );
    } catch (apiError) {
      console.error("❌ API request failed:");
      console.error("   Status:", apiError.response?.status);
      console.error("   Status Text:", apiError.response?.statusText);
      console.error(
        "   Response Body:",
        JSON.stringify(apiError.response?.data, null, 2),
      );
      throw apiError;
    }

    const { id: sessionId, cdp_url } = sessionResponse.data.data;
    console.log(`✅ Session spawned. ID: ${sessionId}`);
    console.log(`   CDP URL: ${cdp_url}`);
    if (sessionResponse.data.data.live_view_url) {
      console.log(
        `   Live View: ${sessionResponse.data.data.live_view_url}`,
      );
    }

    const browser = await chromium.connectOverCDP(cdp_url);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());

    console.log("🌐 Navigating to Microsoft Teams web client...");
    await page.goto("https://teams.microsoft.com/v2/");

    if (await page.isVisible('input[type="email"]')) {
      console.log("\n⚠️ ACTION REQUIRED: Login elements detected.");
      console.log(
        "Please access your Anchor Dashboard recording viewer, log in, and finish your corporate MFA screen.",
      );

      await page.waitForSelector('[data-tid="left-rail-header"]', {
        timeout: 300000,
      });
      console.log("🎉 Login confirmed! Proceeding to target text fetch...");
    }

    console.log(
      `🔍 Searching for active chat thread with: "${TARGET_USER_NAME}"`,
    );

    const targetChatSelector = `[data-tid="chat-list-item"]:has-text("${TARGET_USER_NAME}")`;
    await page.waitForSelector(targetChatSelector, { timeout: 15000 });
    await page.click(targetChatSelector);

    await page.waitForTimeout(3000);

    console.log("📥 Extracting latest message strings...");
    const messageBubbles = await page.$$('[data-tid="message-body"]');

    if (messageBubbles.length > 0) {
      const lastBubble = messageBubbles[messageBubbles.length - 1];
      const messageText = await lastBubble.innerText();

      console.log("\n=================== RESULT ===================");
      console.log(`Last Message from ${TARGET_USER_NAME}:`);
      console.log(`"${messageText}"`);
      console.log("==============================================");
    } else {
      console.log(
        "❌ Found the chat thread, but no message bodies were found in the visible DOM window.",
      );
    }

    await browser.close();
    console.log("\n🏁 Test execution completed successfully.");
  } catch (error) {
    console.error("🔴 Execution halted with exception Error:", error.message);
  }
}

runTeamsTest();
