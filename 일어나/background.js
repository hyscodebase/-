const MAIN_ALARM = "stand-up-reminder";
const SNOOZE_ALARM = "stand-up-snooze";
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 180;

const DEFAULT_STATE = {
  intervalMinutes: 50,
  isRunning: true,
  nextAlarmAt: null,
  reminderDate: "",
  reminderCount: 0,
};

function normalizeInterval(value) {
  const interval = Math.round(Number(value));

  if (!Number.isFinite(interval)) {
    return DEFAULT_STATE.intervalMinutes;
  }

  return Math.min(
    MAX_INTERVAL_MINUTES,
    Math.max(MIN_INTERVAL_MINUTES, interval),
  );
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getStoredState() {
  const stored = await chrome.storage.local.get(DEFAULT_STATE);

  return {
    ...DEFAULT_STATE,
    ...stored,
    intervalMinutes: normalizeInterval(stored.intervalMinutes),
    isRunning: Boolean(stored.isRunning),
  };
}

async function updateActionAppearance(isRunning) {
  await chrome.action.setBadgeBackgroundColor({
    color: isRunning ? "#ff7a59" : "#a89b94",
  });
  await chrome.action.setBadgeText({ text: isRunning ? "" : "Ⅱ" });
  await chrome.action.setTitle({
    title: isRunning
      ? "일어나! 기지개 알림 · 작동 중"
      : "일어나! 기지개 알림 · 잠시 쉬는 중",
  });
}

async function scheduleMainAlarm(intervalMinutes, delayMinutes = intervalMinutes) {
  const interval = normalizeInterval(intervalMinutes);
  const delay = Math.max(1, Number(delayMinutes) || interval);

  await chrome.alarms.clear(MAIN_ALARM);
  await chrome.alarms.create(MAIN_ALARM, {
    delayInMinutes: delay,
    periodInMinutes: interval,
  });

  const alarm = await chrome.alarms.get(MAIN_ALARM);
  const nextAlarmAt = alarm?.scheduledTime ?? Date.now() + delay * 60_000;

  await chrome.storage.local.set({
    intervalMinutes: interval,
    isRunning: true,
    nextAlarmAt,
  });
  await updateActionAppearance(true);

  return nextAlarmAt;
}

async function pauseTimer() {
  await Promise.all([
    chrome.alarms.clear(MAIN_ALARM),
    chrome.alarms.clear(SNOOZE_ALARM),
  ]);
  await chrome.storage.local.set({
    isRunning: false,
    nextAlarmAt: null,
  });
  await updateActionAppearance(false);
}

async function scheduleSnooze() {
  const state = await getStoredState();

  if (!state.isRunning) {
    return;
  }

  await chrome.alarms.clear(SNOOZE_ALARM);
  await chrome.alarms.create(SNOOZE_ALARM, { delayInMinutes: 10 });
}

async function reconcileState() {
  const state = await getStoredState();

  if (!state.isRunning) {
    await Promise.all([
      chrome.alarms.clear(MAIN_ALARM),
      chrome.alarms.clear(SNOOZE_ALARM),
    ]);
    await chrome.storage.local.set({ nextAlarmAt: null });
    await updateActionAppearance(false);
    return;
  }

  const alarm = await chrome.alarms.get(MAIN_ALARM);

  if (!alarm) {
    await scheduleMainAlarm(state.intervalMinutes);
    return;
  }

  if (state.nextAlarmAt !== alarm.scheduledTime) {
    await chrome.storage.local.set({ nextAlarmAt: alarm.scheduledTime });
  }

  await updateActionAppearance(true);
}

async function getPublicState() {
  const state = await getStoredState();

  if (!state.isRunning) {
    return { ...state, nextAlarmAt: null };
  }

  const alarm = await chrome.alarms.get(MAIN_ALARM);

  if (!alarm) {
    const nextAlarmAt = await scheduleMainAlarm(state.intervalMinutes);
    return { ...state, nextAlarmAt, isRunning: true };
  }

  if (state.nextAlarmAt !== alarm.scheduledTime) {
    await chrome.storage.local.set({ nextAlarmAt: alarm.scheduledTime });
  }

  return { ...state, nextAlarmAt: alarm.scheduledTime };
}

async function incrementReminderCount() {
  const state = await getStoredState();
  const today = getLocalDateKey();
  const reminderCount =
    state.reminderDate === today ? state.reminderCount + 1 : 1;

  await chrome.storage.local.set({
    reminderDate: today,
    reminderCount,
  });
}

async function showReminder({ isSnooze = false, isTest = false } = {}) {
  const state = await getStoredState();

  if (!isTest && !state.isRunning) {
    return;
  }

  const notificationId = `stand-up-${Date.now()}`;
  const title = isTest
    ? "알림 준비 완료! 🐻"
    : isSnooze
      ? "곰돌이가 다시 왔어요!"
      : "잠깐, 기지개 켤 시간이에요!";
  const message = isTest
    ? `${state.intervalMinutes}분마다 이렇게 알려드릴게요.`
    : "어깨를 돌리고, 물 한 모금 마시고, 1분만 걸어볼까요?";

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
    priority: 2,
    requireInteraction: true,
    buttons: [
      { title: "일어났어요 🙌" },
      { title: "10분 뒤에 다시" },
    ],
  });

  if (!isTest) {
    await incrementReminderCount();
  }
}

async function updateNextMainAlarmTime(alarm) {
  const state = await getStoredState();
  const intervalMs = state.intervalMinutes * 60_000;
  let nextAlarmAt = alarm.scheduledTime + intervalMs;

  while (nextAlarmAt <= Date.now()) {
    nextAlarmAt += intervalMs;
  }

  await chrome.storage.local.set({ nextAlarmAt });
}

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATE":
      return { state: await getPublicState() };

    case "TOGGLE_RUNNING": {
      const state = await getStoredState();

      if (state.isRunning) {
        await pauseTimer();
      } else {
        await scheduleMainAlarm(state.intervalMinutes);
      }

      return { state: await getPublicState() };
    }

    case "RESET_TIMER": {
      const state = await getStoredState();

      if (state.isRunning) {
        await scheduleMainAlarm(state.intervalMinutes);
      }

      return { state: await getPublicState() };
    }

    case "SET_INTERVAL": {
      const intervalMinutes = normalizeInterval(message.intervalMinutes);
      const state = await getStoredState();

      await chrome.storage.local.set({ intervalMinutes });

      if (state.isRunning) {
        await scheduleMainAlarm(intervalMinutes);
      }

      return { state: await getPublicState() };
    }

    case "TEST_NOTIFICATION":
      await showReminder({ isTest: true });
      return { state: await getPublicState() };

    default:
      throw new Error("지원하지 않는 요청입니다.");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  reconcileState().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  reconcileState().catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MAIN_ALARM) {
    Promise.all([
      updateNextMainAlarmTime(alarm),
      showReminder(),
    ]).catch(console.error);
  }

  if (alarm.name === SNOOZE_ALARM) {
    showReminder({ isSnooze: true }).catch(console.error);
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId).catch(console.error);
});

chrome.notifications.onButtonClicked.addListener(
  (notificationId, buttonIndex) => {
    chrome.notifications.clear(notificationId).catch(console.error);

    if (buttonIndex === 1) {
      scheduleSnooze().catch(console.error);
    }
  },
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error(error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});

reconcileState().catch(console.error);
