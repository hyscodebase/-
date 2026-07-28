const assert = require("node:assert/strict");
const path = require("node:path");

function createEvent() {
  const listeners = [];

  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      return listeners.map((listener) => listener(...args));
    },
    get firstListener() {
      return listeners[0];
    },
  };
}

function waitForAsyncHandlers() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const storageData = {};
const alarms = new Map();
const notifications = [];

const events = {
  onInstalled: createEvent(),
  onStartup: createEvent(),
  onMessage: createEvent(),
  onAlarm: createEvent(),
  onNotificationClicked: createEvent(),
  onNotificationButtonClicked: createEvent(),
  onStorageChanged: createEvent(),
};

global.chrome = {
  storage: {
    local: {
      async get(defaults) {
        return { ...defaults, ...storageData };
      },
      async set(values) {
        Object.assign(storageData, values);
      },
    },
    onChanged: events.onStorageChanged,
  },
  alarms: {
    async clear(name) {
      return alarms.delete(name);
    },
    async create(name, info) {
      alarms.set(name, {
        name,
        periodInMinutes: info.periodInMinutes,
        scheduledTime: Date.now() + info.delayInMinutes * 60_000,
      });
    },
    async get(name) {
      return alarms.get(name);
    },
    onAlarm: events.onAlarm,
  },
  action: {
    async setBadgeBackgroundColor() {},
    async setBadgeText() {},
    async setTitle() {},
  },
  notifications: {
    async create(id, options) {
      notifications.push({ id, options });
      return id;
    },
    async clear() {
      return true;
    },
    onClicked: events.onNotificationClicked,
    onButtonClicked: events.onNotificationButtonClicked,
  },
  runtime: {
    onInstalled: events.onInstalled,
    onStartup: events.onStartup,
    onMessage: events.onMessage,
    getURL(relativePath) {
      return `chrome-extension://test/${relativePath}`;
    },
  },
};

async function sendMessage(message) {
  return new Promise((resolve) => {
    events.onMessage.firstListener(message, {}, resolve);
  });
}

async function run() {
  require(path.resolve(__dirname, "../background.js"));
  await waitForAsyncHandlers();

  let response = await sendMessage({ type: "GET_STATE" });
  assert.equal(response.ok, true);
  assert.equal(response.state.intervalMinutes, 50);
  assert.equal(response.state.isRunning, true);
  assert.equal(alarms.get("stand-up-reminder").periodInMinutes, 50);

  response = await sendMessage({ type: "TEST_NOTIFICATION" });
  assert.equal(response.ok, true);
  assert.equal(notifications.length, 1);
  assert.equal(storageData.reminderCount ?? 0, 0);

  response = await sendMessage({ type: "SET_INTERVAL", intervalMinutes: 25 });
  assert.equal(response.state.intervalMinutes, 25);
  assert.equal(alarms.get("stand-up-reminder").periodInMinutes, 25);

  response = await sendMessage({ type: "TOGGLE_RUNNING" });
  assert.equal(response.state.isRunning, false);
  assert.equal(alarms.has("stand-up-reminder"), false);

  response = await sendMessage({ type: "TOGGLE_RUNNING" });
  assert.equal(response.state.isRunning, true);
  assert.equal(alarms.has("stand-up-reminder"), true);

  const mainAlarm = alarms.get("stand-up-reminder");
  events.onAlarm.emit(mainAlarm);
  await waitForAsyncHandlers();
  assert.equal(notifications.length, 2);
  assert.equal(storageData.reminderCount, 1);

  const reminderNotification = notifications.at(-1);
  events.onNotificationButtonClicked.emit(reminderNotification.id, 1);
  await waitForAsyncHandlers();
  assert.equal(alarms.has("stand-up-snooze"), true);

  console.log("background integration checks passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
