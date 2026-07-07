import OpenAI from "openai";

export const SOURCE_USER = process.env.SOURCE_USER || "Haseeb Devops";
export const TARGET_USER = process.env.TARGET_USER || "Natenal FSD";
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 500;
const REPLY_DELAY_MIN_MS = Number(process.env.REPLY_DELAY_MIN_MS) || 3000;
const REPLY_DELAY_MAX_MS = Number(process.env.REPLY_DELAY_MAX_MS) || 7000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FALLBACK_REPLY =
  "one moment, let me check that and get back to you";

const SYSTEM_PROMPT = `You are an intelligent assistant that helps gather task requirements from a user named "${SOURCE_USER}". 
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
- If the message is a direct question or request that you cannot confidently answer with accurate information, do NOT guess. Respond with exactly:

\`\`\`NEED_TO_CHECK
\`\`\`

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
let lastProcessedMessageId = null;
let lastProcessedMessageText = null;
let pollCount = 0;

function isNewMessage(message) {
  if (!message?.text) return false;
  if (message.id) return message.id !== lastProcessedMessageId;
  return message.text !== lastProcessedMessageText;
}

function markMessageProcessed(message) {
  lastProcessedMessageId = message.id ?? null;
  lastProcessedMessageText = message.text;
}

function excerpt(text, maxLength = 80) {
  if (!text) return "(none)";
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength)}...`;
}

async function waitBeforeReply(page) {
  const min = Math.min(REPLY_DELAY_MIN_MS, REPLY_DELAY_MAX_MS);
  const max = Math.max(REPLY_DELAY_MIN_MS, REPLY_DELAY_MAX_MS);
  const delayMs = Math.round(min + Math.random() * (max - min));
  console.log(`⏳ Pausing ${(delayMs / 1000).toFixed(1)}s before reply...`);
  await page.waitForTimeout(delayMs);
}

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
  const needToCheck = /```NEED_TO_CHECK\s*```/.test(assistantMessage);

  if (needToCheck) {
    return { type: "defer", reply: FALLBACK_REPLY, task: null };
  }

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

export async function sendMessage(page, text) {
  const messageBox = page.locator('[role="textbox"]');
  await messageBox.click();
  await messageBox.fill(text);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
}

export async function getLatestChatMessage(page) {
  return page.evaluate(({ sourceUser }) => {
    const items = [
      ...document.querySelectorAll('[data-tid="chat-pane-item"]'),
    ].filter((item) => item.querySelector('[data-testid="message-wrapper"]'));

    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const authorEl = item.querySelector('[data-tid="message-author-name"]');
      const messageEl = item.querySelector('[data-tid="chat-pane-message"]');
      if (!authorEl || !messageEl) continue;

      const contentEl = messageEl.querySelector("[data-message-content]");
      if (!contentEl) continue;

      const clone = contentEl.cloneNode(true);
      clone
        .querySelectorAll('[data-tid="quoted-reply-card"]')
        .forEach((el) => el.remove());

      let text = clone.innerText.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

      if (!text) {
        text = (contentEl.getAttribute("aria-label") || "").trim();
      }

      if (!text) continue;

      const author = authorEl.textContent.trim();
      return {
        id: messageEl.getAttribute("data-mid"),
        text,
        author,
        isFromSource: author === sourceUser,
      };
    }

    return null;
  }, { sourceUser: SOURCE_USER });
}

export async function getLatestIncomingMessage(page) {
  const latest = await getLatestChatMessage(page);
  if (!latest?.isFromSource) return null;
  return { id: latest.id, text: latest.text };
}

async function resetConversationBaseline(page) {
  conversationHistory = [];
  await navigateToChat(page, SOURCE_USER);
  const baseline = await getLatestIncomingMessage(page);
  if (baseline) markMessageProcessed(baseline);
  else {
    lastProcessedMessageId = null;
    lastProcessedMessageText = null;
  }
}

async function processIncomingMessage(page, message) {
  markMessageProcessed(message);
  console.log(`\n💬 Message from ${SOURCE_USER}: "${message.text}"`);

  const result = await evaluateWithLLM(message.text);

  if (result.type === "task_ready") {
    console.log("✅ All information gathered! Task is ready.");
    await sendTaskToTarget(page, result.task);
    await resetConversationBaseline(page);
    console.log("\n🔄 Reset. Waiting for next request...");
    return;
  }

  if (result.type === "defer") {
    console.log(`🤖 Cannot answer confidently. Replying: "${result.reply}"`);
    await waitBeforeReply(page);
    await sendMessage(page, result.reply);
    return;
  }

  if (result.type === "follow_up") {
    console.log(`🤖 Asking follow-up: "${result.reply}"`);
    await waitBeforeReply(page);
    await sendMessage(page, result.reply);
  }
}

export async function navigateToChat(page, userName) {
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

export async function ensureTeamsLoaded(page) {
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
    console.log("\n⚠️ Login required. Please log in in the browser window.");
    await page.waitForSelector('[data-tid="left-rail-header"]', {
      timeout: 300000,
    });
    console.log("🎉 Login confirmed!");
  }
}

export async function runTeamsMonitor(page) {
  console.log(`👤 Tracking: ${SOURCE_USER}`);
  console.log(`📨 Will forward tasks to: ${TARGET_USER}`);

  await ensureTeamsLoaded(page);

  await navigateToChat(page, SOURCE_USER);
  const latestChat = await getLatestChatMessage(page);

  if (latestChat?.isFromSource) {
    console.log(
      `\n📬 Unanswered message on startup: "${excerpt(latestChat.text)}"`,
    );
    await processIncomingMessage(page, {
      id: latestChat.id,
      text: latestChat.text,
    });
  } else {
    const latestFromSource = await getLatestIncomingMessage(page);
    if (latestFromSource) {
      markMessageProcessed(latestFromSource);
      console.log(
        `   (Last ${SOURCE_USER} message already answered: "${excerpt(latestFromSource.text)}")`,
      );
    }
  }

  console.log(
    `\n🔄 Monitoring started. Polling every ${POLL_INTERVAL_MS / 1000}s...`,
  );

  await notifyMe(
    page,
    `🟢 Bot is online. Now monitoring "${SOURCE_USER}" for incoming tasks.`,
  );
  await navigateToChat(page, SOURCE_USER);

  while (true) {
    await page.waitForTimeout(POLL_INTERVAL_MS);

    try {
      pollCount += 1;
      const latestMessage = await getLatestIncomingMessage(page);
      const isNew = isNewMessage(latestMessage);

      console.log(
        `[poll #${pollCount}] id=${latestMessage?.id ?? "none"} latest="${excerpt(latestMessage?.text)}" | status=${isNew ? "new" : latestMessage ? "unchanged" : "no message"}`,
      );

      if (isNew && latestMessage) {
        await processIncomingMessage(page, latestMessage);
      }
    } catch (pollError) {
      console.error("⚠️ Poll cycle error:", pollError.message);
      await notifyMe(page, `⚠️ Error in monitoring loop: ${pollError.message}`);
      await navigateToChat(page, SOURCE_USER);
      await page.waitForTimeout(5000);
    }
  }
}
