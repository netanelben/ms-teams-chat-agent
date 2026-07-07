import { chromium } from "playwright";
import axios from "axios";
import OpenAI from "openai";
import "dotenv/config";

const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SOURCE_USER = "Haseeb Devops";
const TARGET_USER = "Natenal FSD";
const POLL_INTERVAL_MS = 300000;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are an intelligent assistant that helps gather task requirements from a user named "Haseeb Devops". 
He often sends incomplete requests without all the necessary details.

Your job:
1. Analyze each incoming message from Haseeb.
2. Determine if the message contains a complete task request with ALL necessary details (what needs to be done, context, deadlines, affected systems, priority, etc).
3. If information is missing, ask clear and specific follow-up questions to get the missing details.
4. Once you have gathered ALL the information needed to start working on the task, produce a final structured task summary.

IMPORTANT RULES:
- Be friendly but concise in your questions.
- Ask ONE or TWO questions at a time, not a long list.
- Remember context from the conversation history.
- When you determine you have enough information, respond with a JSON block in this exact format:

\`\`\`TASK_READY
{
  "title": "Brief task title",
  "description": "Full description of what needs to be done",
  "priority": "high/medium/low",
  "details": "All gathered details and context",
  "original_request": "The original message from Haseeb"
}
\`\`\`

Only output the TASK_READY block when you are confident ALL necessary information has been collected.`;

let conversationHistory = [];
let lastProcessedMessageText = null;

async function evaluateWithLLM(newMessage) {
  conversationHistory.push({ role: "user", content: newMessage });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...conversationHistory,
    ],
    temperature: 0.7,
  });

  const assistantMessage = response.choices[0].message.content;
  conversationHistory.push({ role: "assistant", content: assistantMessage });

  const taskMatch = assistantMessage.match(/```TASK_READY\s*([\s\S]*?)\s*```/);

  if (taskMatch) {
    try {
      const taskData = JSON.parse(taskMatch[1]);
      return { type: "task_ready", task: taskData, reply: null };
    } catch {
      return { type: "follow_up", reply: assistantMessage, task: null };
    }
  }

  return { type: "follow_up", reply: assistantMessage, task: null };
}

async function sendMessage(page, text) {
  const messageBox = page.locator(
    '[data-tid="ckeditor-replyConversation"] [role="textbox"]',
  );
  await messageBox.click();
  await messageBox.fill(text);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
}

async function getLatestIncomingMessage(page) {
  const messages = await page.$$('[data-tid="chat-pane-message"]');
  if (messages.length === 0) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const senderEl = await msg.$('[data-tid="message-author-name"]');
    if (!senderEl) continue;
    const sender = (await senderEl.innerText()).trim();

    if (sender === SOURCE_USER) {
      const bodyEl = await msg.$('[data-tid="message-body"]');
      if (!bodyEl) continue;
      return (await bodyEl.innerText()).trim();
    }
  }
  return null;
}

async function navigateToChat(page, userName) {
  console.log(`🔍 Opening chat with: "${userName}"`);
  const chatSelector = `[data-testid="list-item"]:has(span[role="text"]:text("${userName}"))`;
  await page.waitForSelector(chatSelector, { timeout: 15000 });
  await page.click(chatSelector);
  await page.waitForTimeout(2000);
}

async function sendTaskToTarget(page, taskData) {
  console.log(`\n📤 Task complete! Sending summary to ${TARGET_USER}...`);

  await navigateToChat(page, TARGET_USER);

  const taskMessage = [
    `📋 New Task from ${SOURCE_USER}:`,
    ``,
    `Title: ${taskData.title}`,
    `Priority: ${taskData.priority}`,
    ``,
    `Description:`,
    taskData.description,
    ``,
    `Details:`,
    taskData.details,
    ``,
    `Original request: "${taskData.original_request}"`,
  ].join("\n");

  await sendMessage(page, taskMessage);
  console.log("✅ Task summary sent successfully!");
}

async function notifyMe(page, message) {
  try {
    await navigateToChat(page, TARGET_USER);
    await sendMessage(page, message);
    console.log(`📨 Notification sent to ${TARGET_USER}: "${message}"`);
  } catch (err) {
    console.error(`⚠️ Failed to send notification: ${err.message}`);
  }
}

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

async function runTeamsMonitor() {
  console.log("🚀 Initializing Anchor Browser Session...");
  console.log(`👤 Tracking: ${SOURCE_USER}`);
  console.log(`📨 Will forward tasks to: ${TARGET_USER}`);

  try {
    const { sessionId, cdp_url } = await getOrCreateSession();

    if (!cdp_url) {
      throw new Error("No CDP URL available. Cannot connect to browser.");
    }

    console.log(`🔌 Connecting to browser via CDP...`);
    const browser = await chromium.connectOverCDP(cdp_url);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());

    const currentUrl = page.url();
    const isAlreadyOnTeams =
      currentUrl.includes("teams.microsoft.com") ||
      currentUrl.includes("teams.cloud.microsoft");
    const chatAlreadyVisible =
      isAlreadyOnTeams && (await page.isVisible('[data-testid="list-item"]'));

    if (chatAlreadyVisible) {
      console.log("🌐 Teams already loaded, skipping navigation.");
    } else {
      console.log("🌐 Navigating to Microsoft Teams...");
      await page.goto("https://teams.microsoft.com/v2/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      console.log("⏳ Waiting for Teams to fully load...");
      await page.waitForSelector('[data-testid="list-item"]', {
        timeout: 75000,
      });
    }
    console.log("✅ Teams loaded.");

    if (await page.isVisible('input[type="email"]')) {
      console.log(
        "\n⚠️ Login required. Please log in via the Anchor Dashboard live view.",
      );
      await page.waitForSelector('[data-tid="left-rail-header"]', {
        timeout: 300000,
      });
      console.log("🎉 Login confirmed!");
    }

    await navigateToChat(page, SOURCE_USER);
    lastProcessedMessageText = await getLatestIncomingMessage(page);
    console.log(
      `\n🔄 Monitoring started. Polling every ${POLL_INTERVAL_MS / 1000}s...`,
    );
    if (lastProcessedMessageText) {
      console.log(
        `   (Ignoring existing last message: "${lastProcessedMessageText.slice(0, 50)}...")`,
      );
    }

    await notifyMe(
      page,
      `🟢 Bot is online. Now monitoring "${SOURCE_USER}" for incoming tasks.`,
    );
    await navigateToChat(page, SOURCE_USER);

    while (true) {
      await page.waitForTimeout(POLL_INTERVAL_MS);

      try {
        const latestMessage = await getLatestIncomingMessage(page);

        if (latestMessage && latestMessage !== lastProcessedMessageText) {
          lastProcessedMessageText = latestMessage;
          console.log(
            `\n💬 New message from ${SOURCE_USER}: "${latestMessage}"`,
          );

          const result = await evaluateWithLLM(latestMessage);

          if (result.type === "task_ready") {
            console.log("✅ All information gathered! Task is ready.");
            await sendTaskToTarget(page, result.task);

            conversationHistory = [];
            await navigateToChat(page, SOURCE_USER);
            console.log("\n🔄 Reset. Waiting for next request...");
          } else if (result.type === "follow_up") {
            console.log(`🤖 Asking follow-up: "${result.reply}"`);
            await sendMessage(page, result.reply);
          }
        }
      } catch (pollError) {
        console.error("⚠️ Poll cycle error:", pollError.message);
        await notifyMe(
          page,
          `⚠️ Error in monitoring loop: ${pollError.message}`,
        );
        await navigateToChat(page, SOURCE_USER);
        await page.waitForTimeout(5000);
      }
    }
  } catch (error) {
    console.error("🔴 Fatal error:", error.message);
    process.exit(1);
  }
}

runTeamsMonitor();
