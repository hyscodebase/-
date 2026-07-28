const elements = {
  statusPill: document.querySelector("#statusPill"),
  statusText: document.querySelector("#statusText"),
  countdown: document.querySelector("#countdown"),
  timerCaption: document.querySelector("#timerCaption"),
  timerRing: document.querySelector("#timerRing"),
  nextTime: document.querySelector("#nextTime"),
  toggleButton: document.querySelector("#toggleButton"),
  toggleIcon: document.querySelector("#toggleIcon"),
  toggleLabel: document.querySelector("#toggleLabel"),
  resetButton: document.querySelector("#resetButton"),
  dailyCount: document.querySelector("#dailyCount"),
  intervalInput: document.querySelector("#intervalInput"),
  saveIntervalButton: document.querySelector("#saveIntervalButton"),
  testButton: document.querySelector("#testButton"),
  toast: document.querySelector("#toast"),
};

let currentState = null;
let toastTimer = null;
let isBusy = false;

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.visible = "true";

  toastTimer = window.setTimeout(() => {
    elements.toast.dataset.visible = "false";
  }, 2300);
}

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });

  if (!response?.ok) {
    throw new Error(response?.error || "요청을 처리하지 못했어요.");
  }

  return response.state;
}

function renderDailyCount(state) {
  const count =
    state.reminderDate === getLocalDateKey() ? state.reminderCount : 0;

  elements.dailyCount.textContent =
    count > 0
      ? `오늘 곰돌이가 ${count}번 찾아왔어요`
      : "오늘 첫 기지개를 기다리는 중";
}

function renderTimer() {
  if (!currentState) {
    return;
  }

  const totalMilliseconds = currentState.intervalMinutes * 60_000;
  const remainingMilliseconds = currentState.isRunning
    ? Math.max(0, currentState.nextAlarmAt - Date.now())
    : totalMilliseconds;
  const progress = currentState.isRunning
    ? Math.min(1, remainingMilliseconds / totalMilliseconds)
    : 0;

  elements.countdown.textContent = currentState.isRunning
    ? formatCountdown(remainingMilliseconds)
    : "쉬는 중";
  elements.timerRing.style.setProperty("--progress", `${progress * 360}deg`);

  if (currentState.isRunning && currentState.nextAlarmAt) {
    elements.nextTime.textContent = `다음 알림 · ${formatTime(
      currentState.nextAlarmAt,
    )}`;
  } else {
    elements.nextTime.textContent = "준비되면 다시 시작해 주세요";
  }

  if (
    currentState.isRunning &&
    currentState.nextAlarmAt &&
    remainingMilliseconds === 0
  ) {
    elements.timerCaption.textContent = "곰돌이 출발!";
  }
}

function renderState(state, { syncInput = true } = {}) {
  currentState = state;
  const isRunning = state.isRunning;

  elements.statusPill.dataset.running = String(isRunning);
  elements.statusText.textContent = isRunning ? "작동 중" : "잠시 쉬는 중";
  elements.timerRing.dataset.running = String(isRunning);
  elements.timerCaption.textContent = isRunning ? "집중할 시간" : "푹 쉬고 와요";
  elements.toggleButton.dataset.running = String(isRunning);
  elements.toggleButton.setAttribute("aria-pressed", String(!isRunning));
  elements.toggleIcon.textContent = isRunning ? "Ⅱ" : "▶";
  elements.toggleLabel.textContent = isRunning ? "잠시 멈추기" : "다시 시작하기";
  elements.resetButton.disabled = !isRunning || isBusy;
  elements.resetButton.setAttribute("aria-disabled", String(!isRunning));

  if (syncInput) {
    elements.intervalInput.value = String(state.intervalMinutes);
  }

  renderDailyCount(state);
  renderTimer();
}

function setBusy(busy) {
  isBusy = busy;
  elements.toggleButton.disabled = busy;
  elements.saveIntervalButton.disabled = busy;
  elements.testButton.disabled = busy;
  elements.resetButton.disabled =
    busy || !currentState || !currentState.isRunning;
}

async function runAction(action, successMessage) {
  if (isBusy) {
    return;
  }

  setBusy(true);

  try {
    const state = await action();
    renderState(state);

    if (successMessage) {
      showToast(
        typeof successMessage === "function"
          ? successMessage(state)
          : successMessage,
      );
    }
  } catch (error) {
    console.error(error);
    showToast(error instanceof Error ? error.message : "다시 시도해 주세요.");
  } finally {
    setBusy(false);
  }
}

async function loadState({ syncInput = true } = {}) {
  try {
    const state = await request("GET_STATE");
    renderState(state, { syncInput });
  } catch (error) {
    console.error(error);
    showToast("타이머 상태를 불러오지 못했어요.");
  }
}

elements.toggleButton.addEventListener("click", () => {
  const wasRunning = currentState?.isRunning;
  runAction(
    () => request("TOGGLE_RUNNING"),
    wasRunning ? "잠시 쉬어갈게요 ☕" : "기지개 타이머를 시작했어요!",
  );
});

elements.resetButton.addEventListener("click", () => {
  runAction(
    () => request("RESET_TIMER"),
    "지금부터 다시 셀게요 ↻",
  );
});

elements.saveIntervalButton.addEventListener("click", () => {
  const intervalMinutes = Number(elements.intervalInput.value);

  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 5 ||
    intervalMinutes > 180
  ) {
    showToast("5~180 사이의 분을 입력해 주세요.");
    elements.intervalInput.focus();
    return;
  }

  runAction(
    () => request("SET_INTERVAL", { intervalMinutes }),
    (state) => `${state.intervalMinutes}분 간격으로 바꿨어요.`,
  );
});

elements.intervalInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    elements.saveIntervalButton.click();
  }
});

elements.testButton.addEventListener("click", () => {
  runAction(
    () => request("TEST_NOTIFICATION"),
    "테스트 알림을 보냈어요 🔔",
  );
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "local" && !isBusy) {
    loadState({ syncInput: document.activeElement !== elements.intervalInput });
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadState();
  }
});

window.setInterval(renderTimer, 1000);
loadState();
