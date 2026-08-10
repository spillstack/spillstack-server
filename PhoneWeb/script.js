const socket = io();

let currentRoomCode = "";
let myPlayerId = "";
let passwordPanicMode = "";
let isJoining = false;

let bowlingMotionEnabled = false;
let bowlingCalibrated = false;
let bowlingCurrentPlayerId = "";
let bowlingListening = false;
let bowlingBaselineZ = 0;
let bowlingBaselineX = 0;
let bowlingBaselineY = 0;
let bowlingPeakForward = 0;
let bowlingPeakSide = 0;
let bowlingPeakSpin = 0;
let bowlingLastMotionTime = 0;

// Wii-style hold/release bowling controls
let bowlingHolding = false;
let bowlingThrowInFlight = false;
let bowlingActivePointerId = null;

// Live motion streaming + swing filtering.
// Motion is sent ~25 times per second while HOLD TO BOWL is held.
let bowlingMotionSequence = 0;
let bowlingLastLiveSendTime = 0;
let bowlingLiveForward = 0;
let bowlingLiveSide = 0;
let bowlingLiveSpin = 0;
let bowlingWeightedSideSum = 0;
let bowlingWeightedSpinSum = 0;
let bowlingMotionWeightTotal = 0;
let bowlingMotionSampleCount = 0;
let bowlingPowerBuzzed = false;

const BOWLING_LIVE_SEND_INTERVAL_MS = 40; // 25 updates/sec: responsive without flooding Render
const BOWLING_ACCEL_DEADZONE = 0.45;
const BOWLING_ACCEL_FULL_SCALE = 14.0;
const BOWLING_SIDE_FULL_SCALE = 10.0;
const BOWLING_SPIN_FULL_SCALE = 220.0;
const BOWLING_MIN_DETECTED_SWING = 0.02;

// DRAWING VARIABLES
let drawingCanvas = null;
let drawingContext = null;
let isDrawing = false;

function showScreen(screenId) {
  document.getElementById("joinScreen").classList.add("hidden");
  document.getElementById("waitingScreen").classList.add("hidden");
  document.getElementById("voteScreen").classList.add("hidden");
  document.getElementById("copycatScreen").classList.add("hidden");
  document.getElementById("hotSeatScreen").classList.add("hidden");
  document.getElementById("passwordPanicScreen").classList.add("hidden");
  document.getElementById("drawingScreen").classList.add("hidden");
  document.getElementById("bowlingScreen").classList.add("hidden");
  document.getElementById("doneScreen").classList.add("hidden");

  document.getElementById(screenId).classList.remove("hidden");
}

function setDoneScreen(title, message) {
  document.getElementById("doneTitle").innerText = title;
  document.getElementById("doneMessage").innerText = message;
}

function setJoinButtonState(canClick) {
  const joinButton = document.getElementById("joinButton");

  if (joinButton != null) {
    joinButton.disabled = !canClick;
    joinButton.innerText = canClick ? "Join Game" : "Joining...";
  }
}

function resetPhoneToJoinScreen(message) {
  currentRoomCode = "";
  myPlayerId = "";
  passwordPanicMode = "";
  isJoining = false;

  bowlingHolding = false;
  bowlingThrowInFlight = false;
  bowlingActivePointerId = null;
  bowlingCurrentPlayerId = "";
  bowlingCalibrated = false;
  bowlingMotionEnabled = false;
  resetBowlingMotion();

  setJoinButtonState(true);

  const roomInput = document.getElementById("roomInput");
  const joinMessage = document.getElementById("joinMessage");

  if (roomInput != null) {
    roomInput.value = "";
  }

  if (joinMessage != null) {
    joinMessage.innerText = message;
  }

  showScreen("joinScreen");
}

function joinRoom() {
  if (isJoining) {
    return;
  }

  const playerName = document.getElementById("nameInput").value.trim();
  const roomCode = document.getElementById("roomInput").value.trim();

  if (playerName === "" || roomCode === "") {
    document.getElementById("joinMessage").innerText = "Enter your name and room code.";
    return;
  }

  if (playerName.length > 40) {
    document.getElementById("joinMessage").innerText = "Name must be 40 characters or less.";
    return;
  }

  isJoining = true;
  setJoinButtonState(false);

  document.getElementById("joinMessage").innerText = "Connecting...";

  currentRoomCode = roomCode;

  socket.emit("player:joinRoom", {
    roomCode: roomCode,
    playerName: playerName,
  });
}

function submitCopycatAnswer() {
  const answerInput = document.getElementById("copycatAnswerInput");
  const answer = answerInput.value.trim();

  if (answer === "") {
    document.getElementById("copycatMessage").innerText = "Type an answer first.";
    return;
  }

  socket.emit("player:submitCopycatAnswer", {
    roomCode: currentRoomCode,
    answer: answer,
  });

  setDoneScreen("Answer locked in!", "Waiting for everyone else...");
  showScreen("doneScreen");
}

function submitHotSeatAnswer() {
  const answerInput = document.getElementById("hotSeatAnswerInput");
  const answer = answerInput.value.trim();

  if (answer === "") {
    document.getElementById("hotSeatMessage").innerText = "Type an answer first.";
    return;
  }

  socket.emit("player:submitHotSeatAnswer", {
    roomCode: currentRoomCode,
    answer: answer,
  });

  setDoneScreen("Answer locked in!", "Waiting for everyone else...");
  showScreen("doneScreen");
}

function chooseHotSeatWinner(answerOwnerId) {
  socket.emit("player:chooseHotSeatWinner", {
    roomCode: currentRoomCode,
    winnerPlayerId: answerOwnerId,
  });

  setDoneScreen("Winner picked!", "Look at the main screen for results.");
  showScreen("doneScreen");
}

function submitPasswordPanic() {
  const input = document.getElementById("passwordPanicInput");
  const value = input.value.trim();

  if (value === "") {
    document.getElementById("passwordPanicMessage").innerText = "Type something first.";
    return;
  }

  if (passwordPanicMode === "clue") {
    socket.emit("player:submitPasswordPanicClue", {
      roomCode: currentRoomCode,
      clue: value,
    });

    setDoneScreen("Clue sent!", "Waiting for everyone to guess...");
    showScreen("doneScreen");
    return;
  }

  if (passwordPanicMode === "guess") {
    socket.emit("player:submitPasswordPanicGuess", {
      roomCode: currentRoomCode,
      guess: value,
    });

    setDoneScreen("Guess locked in!", "Waiting for everyone else...");
    showScreen("doneScreen");
    return;
  }

  document.getElementById("passwordPanicMessage").innerText = "Wait for the game to start.";
}

// DRAWING CODE

function setupDrawingCanvas() {
  drawingCanvas = document.getElementById("drawingCanvas");

  if (drawingCanvas == null) {
    return;
  }

  drawingContext = drawingCanvas.getContext("2d");

  drawingContext.fillStyle = "white";
  drawingContext.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);

  drawingContext.lineWidth = 5;
  drawingContext.lineCap = "round";
  drawingContext.lineJoin = "round";
  drawingContext.strokeStyle = "black";

  drawingCanvas.addEventListener("mousedown", startDrawing);
  drawingCanvas.addEventListener("mousemove", draw);
  drawingCanvas.addEventListener("mouseup", stopDrawing);
  drawingCanvas.addEventListener("mouseleave", stopDrawing);

  drawingCanvas.addEventListener("touchstart", startDrawing);
  drawingCanvas.addEventListener("touchmove", draw);
  drawingCanvas.addEventListener("touchend", stopDrawing);
  drawingCanvas.addEventListener("touchcancel", stopDrawing);
}

function getCanvasPosition(event) {
  const rect = drawingCanvas.getBoundingClientRect();

  let clientX;
  let clientY;

  if (event.touches && event.touches.length > 0) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }

  const scaleX = drawingCanvas.width / rect.width;
  const scaleY = drawingCanvas.height / rect.height;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function startDrawing(event) {
  event.preventDefault();

  if (drawingCanvas == null || drawingContext == null) {
    return;
  }

  isDrawing = true;

  const position = getCanvasPosition(event);

  drawingContext.beginPath();
  drawingContext.moveTo(position.x, position.y);
}

function draw(event) {
  event.preventDefault();

  if (!isDrawing) {
    return;
  }

  if (drawingCanvas == null || drawingContext == null) {
    return;
  }

  const position = getCanvasPosition(event);

  drawingContext.lineTo(position.x, position.y);
  drawingContext.stroke();
}

function stopDrawing(event) {
  if (event) {
    event.preventDefault();
  }

  isDrawing = false;
}

function clearDrawing() {
  if (drawingCanvas == null || drawingContext == null) {
    return;
  }

  drawingContext.fillStyle = "white";
  drawingContext.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);

  drawingContext.lineWidth = 5;
  drawingContext.lineCap = "round";
  drawingContext.lineJoin = "round";
  drawingContext.strokeStyle = "black";

  document.getElementById("drawingMessage").innerText = "";
}

function submitDrawing() {
  if (drawingCanvas == null) {
    document.getElementById("drawingMessage").innerText = "Drawing canvas not ready.";
    return;
  }

  const drawingDataUrl = drawingCanvas.toDataURL("image/png");

  socket.emit("player:submitDrawing", {
    roomCode: currentRoomCode,
    drawingDataUrl: drawingDataUrl,
  });

  setDoneScreen("Drawing locked in!", "Waiting for everyone else...");
  showScreen("doneScreen");
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clampSigned(value) {
  return Math.max(-1, Math.min(1, Number(value) || 0));
}

function applySignedDeadzone(value, deadzone) {
  const safeValue = clampSigned(value);
  const amount = Math.abs(safeValue);

  if (amount <= deadzone) {
    return 0;
  }

  const remapped = (amount - deadzone) / (1 - deadzone);
  return Math.sign(safeValue) * clamp01(remapped);
}

function lerpNumber(current, target, amount) {
  return current + (target - current) * amount;
}

function getBowlingAcceleration(event) {
  // Prefer gravity-free acceleration when the browser provides it.
  // iPhone Safari can return null here, so calibration-based gravity data is the fallback.
  const gravityFree = event && event.acceleration;

  if (
    gravityFree &&
    (gravityFree.x != null || gravityFree.y != null || gravityFree.z != null)
  ) {
    return {
      x: Number(gravityFree.x) || 0,
      y: Number(gravityFree.y) || 0,
      z: Number(gravityFree.z) || 0,
    };
  }

  const withGravity = event && event.accelerationIncludingGravity;

  if (!withGravity) {
    return null;
  }

  return {
    x: Number(withGravity.x) || 0,
    y: Number(withGravity.y) || 0,
    z: Number(withGravity.z) || 0,
  };
}

function resetBowlingMotion() {
  bowlingPeakForward = 0;
  bowlingPeakSide = 0;
  bowlingPeakSpin = 0;
  bowlingLastMotionTime = 0;

  bowlingLiveForward = 0;
  bowlingLiveSide = 0;
  bowlingLiveSpin = 0;
  bowlingWeightedSideSum = 0;
  bowlingWeightedSpinSum = 0;
  bowlingMotionWeightTotal = 0;
  bowlingMotionSampleCount = 0;
  bowlingLastLiveSendTime = 0;
  bowlingMotionSequence = 0;
  bowlingPowerBuzzed = false;
}

function isMyBowlingTurn() {
  return bowlingCurrentPlayerId !== "" && bowlingCurrentPlayerId === myPlayerId;
}

function updateBowlingHoldButton() {
  const button = document.getElementById("bowlingThrowButton");
  if (!button) return;

  const canBowl =
    bowlingMotionEnabled &&
    bowlingCalibrated &&
    isMyBowlingTurn() &&
    !bowlingThrowInFlight &&
    !bowlingHolding;

  button.disabled = !canBowl;

  if (bowlingThrowInFlight) {
    button.innerText = "THROW SENT!";
  } else if (bowlingHolding) {
    const percent = Math.round(clamp01(bowlingPeakForward) * 100);
    button.innerText = "POWER " + percent + "% — RELEASE TO THROW";
  } else {
    button.innerText = "HOLD TO BOWL";
  }
}

function sendLiveBowlingMotion(now) {
  if (!socket.connected || !bowlingHolding || !isMyBowlingTurn()) {
    return;
  }

  if (now - bowlingLastLiveSendTime < BOWLING_LIVE_SEND_INTERVAL_MS) {
    return;
  }

  bowlingLastLiveSendTime = now;
  bowlingMotionSequence++;

  socket.emit("player:bowlingMotion", {
    roomCode: currentRoomCode,
    forward: clamp01(bowlingLiveForward),
    side: clampSigned(bowlingLiveSide),
    spin: clampSigned(bowlingLiveSpin),
    power: clamp01(bowlingPeakForward),
    sequence: bowlingMotionSequence,
    clientTime: now,
  });
}

function handleBowlingMotion(event) {
  // The phone only drives the live bowling controller while the orange button is held.
  if (
    !bowlingListening ||
    !bowlingMotionEnabled ||
    !bowlingCalibrated ||
    !bowlingHolding ||
    !isMyBowlingTurn()
  ) {
    return;
  }

  const acceleration = getBowlingAcceleration(event);
  const rotation = event ? event.rotationRate : null;

  if (!acceleration) {
    return;
  }

  const dx = acceleration.x - bowlingBaselineX;
  const dy = acceleration.y - bowlingBaselineY;
  const dz = acceleration.z - bowlingBaselineZ;

  // Overall 3D swing energy makes power much less dependent on exactly how the
  // player happens to hold their phone. Calibration removes the resting offset.
  const accelerationMagnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const forward = clamp01(
    (accelerationMagnitude - BOWLING_ACCEL_DEADZONE) /
      BOWLING_ACCEL_FULL_SCALE
  );

  // x is still useful for left/right aim. A small deadzone stops hand shake
  // from producing unwanted gutter-ball direction changes.
  const side = applySignedDeadzone(
    dx / BOWLING_SIDE_FULL_SCALE,
    0.05
  );

  const rawSpinRate = rotation ? Number(rotation.gamma) || 0 : 0;
  const spin = applySignedDeadzone(
    rawSpinRate / BOWLING_SPIN_FULL_SCALE,
    0.04
  );

  // Smooth the live values so Unity sees a stable controller instead of noisy
  // phone sensor spikes. The final throw still remembers the strongest power.
  bowlingLiveForward = lerpNumber(bowlingLiveForward, forward, 0.42);
  bowlingLiveSide = lerpNumber(bowlingLiveSide, side, 0.30);
  bowlingLiveSpin = lerpNumber(bowlingLiveSpin, spin, 0.30);

  bowlingPeakForward = Math.max(bowlingPeakForward, forward);

  // Aim and curve are weighted toward the energetic part of the swing so a
  // tiny movement before/after the swing does not dominate the final result.
  if (forward > 0.015) {
    const weight = Math.max(0.015, forward * forward);
    bowlingWeightedSideSum += side * weight;
    bowlingWeightedSpinSum += spin * weight;
    bowlingMotionWeightTotal += weight;
  }

  if (Math.abs(side) > Math.abs(bowlingPeakSide)) {
    bowlingPeakSide = side;
  }

  if (Math.abs(spin) > Math.abs(bowlingPeakSpin)) {
    bowlingPeakSpin = spin;
  }

  bowlingMotionSampleCount++;
  bowlingLastMotionTime = Date.now();

  // Small optional haptic cue on phones/browsers that support vibration.
  if (!bowlingPowerBuzzed && bowlingPeakForward >= 0.55) {
    bowlingPowerBuzzed = true;
    if (navigator.vibrate) {
      navigator.vibrate(18);
    }
  }

  updateBowlingHoldButton();
  sendLiveBowlingMotion(bowlingLastMotionTime);
}

async function enableBowlingMotion() {
  const message = document.getElementById("bowlingMessage");

  try {
    if (typeof DeviceMotionEvent === "undefined") {
      message.innerText = "This phone does not provide motion controls.";
      return;
    }

    // iPhone/iPad Safari requires permission from a direct button press.
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      const permission = await DeviceMotionEvent.requestPermission();

      if (permission !== "granted") {
        message.innerText = "Motion permission was denied.";
        return;
      }
    }

    // Only install the listener once. Repeated listeners would make the same
    // physical swing count several times after multiple Bowling games.
    if (!bowlingListening) {
      window.addEventListener("devicemotion", handleBowlingMotion, true);
      bowlingListening = true;
    }

    bowlingMotionEnabled = true;

    message.innerText =
      "Motion controls enabled. Hold your phone still for a second, then press CALIBRATE.";

    document.getElementById("bowlingMotionButton").style.display = "none";
    document.getElementById("bowlingCalibrateButton").style.display = "block";

    updateBowlingHoldButton();
  } catch (error) {
    console.error(error);
    message.innerText = "Could not enable motion controls.";
  }
}

function calibrateBowlingPhone() {
  const message = document.getElementById("bowlingMessage");
  const acceleration = window.__lastBowlingAcceleration;

  if (!acceleration) {
    message.innerText =
      "Motion data is not ready yet. Hold the phone still for a second and tap CALIBRATE again.";
    return;
  }

  bowlingBaselineX = Number(acceleration.x) || 0;
  bowlingBaselineY = Number(acceleration.y) || 0;
  bowlingBaselineZ = Number(acceleration.z) || 0;

  bowlingCalibrated = true;
  bowlingThrowInFlight = false;
  bowlingHolding = false;
  resetBowlingMotion();

  document.getElementById("bowlingCalibrateButton").style.display = "none";

  message.innerText = isMyBowlingTurn()
    ? "Ready! HOLD the orange button, swing forward, then RELEASE it."
    : "Calibrated. Wait for your turn.";

  updateBowlingHoldButton();
}

function beginBowlingHold(event) {
  if (event) {
    event.preventDefault();
  }

  const button = document.getElementById("bowlingThrowButton");
  const message = document.getElementById("bowlingMessage");

  if (
    bowlingHolding ||
    bowlingThrowInFlight ||
    !bowlingMotionEnabled ||
    !bowlingCalibrated ||
    !isMyBowlingTurn()
  ) {
    return;
  }

  if (!socket.connected) {
    message.innerText = "Connection lost. Wait for the phone to reconnect.";
    return;
  }

  bowlingHolding = true;
  resetBowlingMotion();

  socket.emit("player:bowlingMotionStart", {
    roomCode: currentRoomCode,
    clientTime: Date.now(),
  });

  if (navigator.vibrate) {
    navigator.vibrate(12);
  }

  if (
    event &&
    event.pointerId !== undefined &&
    button &&
    button.setPointerCapture
  ) {
    bowlingActivePointerId = event.pointerId;

    try {
      button.setPointerCapture(event.pointerId);
    } catch (error) {
      // Some browsers do not expose pointer capture. The normal pointerup
      // listener still works when the finger remains over the button.
    }
  }

  if (button) {
    button.classList.add("bowlingHolding");
  }

  message.innerText =
    "LIVE CONTROL ACTIVE — keep holding, swing forward, then RELEASE.";

  updateBowlingHoldButton();
}

function cancelBowlingHold(reason) {
  bowlingHolding = false;
  bowlingActivePointerId = null;

  const button = document.getElementById("bowlingThrowButton");
  if (button) {
    button.classList.remove("bowlingHolding");
  }

  if (socket.connected && currentRoomCode !== "") {
    socket.emit("player:bowlingMotionCancel", {
      roomCode: currentRoomCode,
    });
  }

  resetBowlingMotion();

  const message = document.getElementById("bowlingMessage");
  if (message && reason) {
    message.innerText = reason;
  }

  updateBowlingHoldButton();
}

function finishBowlingHold(event) {
  if (event) {
    event.preventDefault();
  }

  if (!bowlingHolding) {
    return;
  }

  const button = document.getElementById("bowlingThrowButton");
  const message = document.getElementById("bowlingMessage");

  bowlingHolding = false;

  if (button) {
    button.classList.remove("bowlingHolding");

    if (
      bowlingActivePointerId !== null &&
      button.hasPointerCapture &&
      button.hasPointerCapture(bowlingActivePointerId)
    ) {
      try {
        button.releasePointerCapture(bowlingActivePointerId);
      } catch (error) {
        // Safe to ignore.
      }
    }
  }

  bowlingActivePointerId = null;

  if (!bowlingCalibrated || !isMyBowlingTurn()) {
    cancelBowlingHold("Your turn ended before the throw was sent.");
    return;
  }

  if (!socket.connected) {
    resetBowlingMotion();
    message.innerText = "Connection lost. Throw was not sent.";
    updateBowlingHoldButton();
    return;
  }

  const rawPower = clamp01(bowlingPeakForward);

  // If a tap/release happened without any measurable movement, keep the turn
  // alive instead of accidentally rolling a ball down the lane.
  if (rawPower < BOWLING_MIN_DETECTED_SWING) {
    cancelBowlingHold("No swing detected. HOLD the button and swing the phone before releasing.");
    return;
  }

  const weightedSide =
    bowlingMotionWeightTotal > 0
      ? bowlingWeightedSideSum / bowlingMotionWeightTotal
      : bowlingPeakSide;

  const weightedSpin =
    bowlingMotionWeightTotal > 0
      ? bowlingWeightedSpinSum / bowlingMotionWeightTotal
      : bowlingPeakSpin;

  const finalSide = applySignedDeadzone(weightedSide, 0.04);
  const finalSpin = applySignedDeadzone(weightedSpin, 0.04);

  bowlingThrowInFlight = true;

  // One last live packet gives Unity the freshest controller pose immediately
  // before the final throw packet arrives.
  bowlingMotionSequence++;
  socket.emit("player:bowlingMotion", {
    roomCode: currentRoomCode,
    forward: rawPower,
    side: finalSide,
    spin: finalSpin,
    power: rawPower,
    sequence: bowlingMotionSequence,
    clientTime: Date.now(),
  });

  socket.emit("player:bowlingThrow", {
    roomCode: currentRoomCode,
    forward: rawPower,
    side: finalSide,
    spin: finalSpin,
    power: rawPower,
    rawPower: rawPower,
    sampleCount: bowlingMotionSampleCount,
  });

  console.log("Bowling throw sent:", {
    power: rawPower,
    side: finalSide,
    spin: finalSpin,
    samples: bowlingMotionSampleCount,
  });

  if (navigator.vibrate) {
    navigator.vibrate(28);
  }

  message.innerText = "THROW SENT! Watch the bowling lane.";
  updateBowlingHoldButton();
  resetBowlingMotion();
}

function setupBowlingHoldButton() {
  const button = document.getElementById("bowlingThrowButton");

  if (!button || button.dataset.bowlingSetup === "1") {
    return;
  }

  // Protect against duplicate event listeners if setup is called again.
  button.dataset.bowlingSetup = "1";

  if (window.PointerEvent) {
    button.addEventListener("pointerdown", beginBowlingHold);
    button.addEventListener("pointerup", finishBowlingHold);
    button.addEventListener("pointercancel", finishBowlingHold);
  } else {
    button.addEventListener("touchstart", beginBowlingHold, { passive: false });
    button.addEventListener("touchend", finishBowlingHold, { passive: false });
    button.addEventListener("touchcancel", finishBowlingHold, { passive: false });
    button.addEventListener("mousedown", beginBowlingHold);
    button.addEventListener("mouseup", finishBowlingHold);
  }

  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  updateBowlingHoldButton();
}

// Keep the most recent acceleration sample available for calibration.
window.addEventListener(
  "devicemotion",
  (event) => {
    const acceleration = getBowlingAcceleration(event);

    if (acceleration) {
      window.__lastBowlingAcceleration = acceleration;
    }
  },
  true
);

window.addEventListener("load", () => {
  setupDrawingCanvas();
  setupBowlingHoldButton();
});

socket.on("player:joinSuccess", (data) => {
  myPlayerId = data.player.id;
  currentRoomCode = data.roomCode;
  isJoining = false;
  setJoinButtonState(true);
  document.getElementById("joinMessage").innerText = "";
  showScreen("waitingScreen");
});

socket.on("player:joinFailed", (message) => {
  isJoining = false;
  setJoinButtonState(true);

  const joinMessage = document.getElementById("joinMessage");

  if (message.includes("Room is full")) {
    joinMessage.innerText = "The room is full";
  } else {
    joinMessage.innerText = message;
  }

  showScreen("joinScreen");
});

socket.on("game:roomClosed", (data) => {
  const message =
    data && data.message
      ? data.message
      : "The game ended. Please enter the new room code.";

  resetPhoneToJoinScreen(message);
});

socket.on("game:questionStarted", (data) => {
  showScreen("voteScreen");

  document.getElementById("questionText").innerText = data.question;

  const playersList = document.getElementById("playersList");
  playersList.innerHTML = "";

  let voteOptions = 0;

  data.players.forEach((player) => {
    if (player.id === myPlayerId) {
      return;
    }

    voteOptions++;

    const button = document.createElement("button");
    button.className = "playerButton";
    button.innerText = player.name;

    button.onclick = () => {
      socket.emit("player:submitVote", {
        roomCode: currentRoomCode,
        votedPlayerId: player.id,
      });

      setDoneScreen("Vote locked in!", "Waiting for everyone else...");
      showScreen("doneScreen");
    };

    playersList.appendChild(button);
  });

  if (voteOptions === 0) {
    playersList.innerHTML = "<p>You need at least 2 players to vote.</p>";
  }
});

socket.on("game:copycatStarted", (data) => {
  showScreen("copycatScreen");

  const promptText = document.getElementById("copycatPromptText");
  const answerInput = document.getElementById("copycatAnswerInput");
  const messageText = document.getElementById("copycatMessage");

  answerInput.value = "";
  messageText.innerText = "";

  if (data.targetPlayerId === myPlayerId) {
    promptText.innerText =
      "COPYCAT\n\n" +
      "You are the target player.\n\n" +
      "Prompt:\n" +
      data.prompt +
      "\n\nType your real answer.";

    answerInput.placeholder = "Type your answer";
  } else {
    promptText.innerText =
      "COPYCAT\n\n" +
      "Target player: " +
      data.targetPlayerName +
      "\n\nPrompt:\n" +
      data.prompt +
      "\n\nGuess what " +
      data.targetPlayerName +
      " will answer.";

    answerInput.placeholder = "Type your guess";
  }
});

socket.on("player:copycatAnswerRejected", (message) => {
  alert(message);
  showScreen("copycatScreen");
});

socket.on("game:copycatFinished", () => {
  setDoneScreen("Round finished!", "Look at the main screen for the results.");
  showScreen("doneScreen");
});

socket.on("game:hotSeatStarted", (data) => {
  showScreen("hotSeatScreen");

  const promptText = document.getElementById("hotSeatPromptText");
  const answerInput = document.getElementById("hotSeatAnswerInput");
  const submitButton = document.getElementById("hotSeatSubmitButton");
  const answersList = document.getElementById("hotSeatAnswersList");
  const messageText = document.getElementById("hotSeatMessage");

  answerInput.value = "";
  answersList.innerHTML = "";
  messageText.innerText = "";

  if (data.hotSeatPlayerId === myPlayerId) {
    promptText.innerText =
      "HOT SEAT\n\n" +
      "You are in the Hot Seat.\n\n" +
      "Prompt:\n" +
      data.prompt +
      "\n\nWait for everyone to submit answers. Then you will pick the winner.";

    answerInput.style.display = "none";
    submitButton.style.display = "none";
  } else {
    promptText.innerText =
      "HOT SEAT\n\n" +
      data.hotSeatPlayerName +
      " is in the Hot Seat.\n\n" +
      "Prompt:\n" +
      data.prompt +
      "\n\nType a funny answer.";

    answerInput.style.display = "block";
    submitButton.style.display = "block";
    answerInput.placeholder = "Type your answer";
  }
});

socket.on("game:hotSeatChooseWinner", (data) => {
  showScreen("hotSeatScreen");

  const promptText = document.getElementById("hotSeatPromptText");
  const answerInput = document.getElementById("hotSeatAnswerInput");
  const submitButton = document.getElementById("hotSeatSubmitButton");
  const answersList = document.getElementById("hotSeatAnswersList");
  const messageText = document.getElementById("hotSeatMessage");

  answerInput.style.display = "none";
  submitButton.style.display = "none";
  answersList.innerHTML = "";
  messageText.innerText = "";

  if (data.hotSeatPlayerId === myPlayerId) {
    promptText.innerText = "HOT SEAT\n\nPick your favourite answer.";

    data.answers.forEach((answerData) => {
      const button = document.createElement("button");
      button.className = "playerButton";
      button.innerText = answerData.answer;

      button.onclick = () => {
        chooseHotSeatWinner(answerData.playerId);
      };

      answersList.appendChild(button);
    });
  } else {
    setDoneScreen("Answers are in!", "Waiting for the Hot Seat player to pick.");
    showScreen("doneScreen");
  }
});

socket.on("player:hotSeatAnswerRejected", (message) => {
  alert(message);
  showScreen("hotSeatScreen");
});

socket.on("game:hotSeatFinished", () => {
  setDoneScreen("Round finished!", "Look at the main screen for the results.");
  showScreen("doneScreen");
});

socket.on("game:passwordPanicStarted", (data) => {
  showScreen("passwordPanicScreen");

  const titleText = document.getElementById("passwordPanicTitleText");
  const infoText = document.getElementById("passwordPanicInfoText");
  const input = document.getElementById("passwordPanicInput");
  const submitButton = document.getElementById("passwordPanicSubmitButton");
  const messageText = document.getElementById("passwordPanicMessage");

  input.value = "";
  messageText.innerText = "";
  input.style.display = "block";
  submitButton.style.display = "block";

  if (data.clueGiverId === myPlayerId) {
    passwordPanicMode = "clue";

    titleText.innerText = "PASSWORD PANIC";
    infoText.innerText =
      "You are the clue giver.\n\n" +
      "Secret word:\n" +
      data.secretWord +
      "\n\nType ONE clue to help everyone guess it.";

    input.placeholder = "Type your clue";
  } else {
    passwordPanicMode = "";

    titleText.innerText = "PASSWORD PANIC";
    infoText.innerText =
      data.clueGiverName +
      " is the clue giver.\n\n" +
      "Waiting for them to give a clue...";

    input.style.display = "none";
    submitButton.style.display = "none";
  }
});

socket.on("game:passwordPanicClueGiven", (data) => {
  showScreen("passwordPanicScreen");

  const titleText = document.getElementById("passwordPanicTitleText");
  const infoText = document.getElementById("passwordPanicInfoText");
  const input = document.getElementById("passwordPanicInput");
  const submitButton = document.getElementById("passwordPanicSubmitButton");
  const messageText = document.getElementById("passwordPanicMessage");

  input.value = "";
  messageText.innerText = "";

  if (data.clueGiverId === myPlayerId) {
    passwordPanicMode = "";

    titleText.innerText = "PASSWORD PANIC";
    infoText.innerText =
      "Your clue:\n" +
      data.clue +
      "\n\nWaiting for everyone to guess...";

    input.style.display = "none";
    submitButton.style.display = "none";
  } else {
    passwordPanicMode = "guess";

    titleText.innerText = "PASSWORD PANIC";
    infoText.innerText =
      "Clue:\n" +
      data.clue +
      "\n\nGuess the secret word.";

    input.style.display = "block";
    submitButton.style.display = "block";
    input.placeholder = "Type your guess";
  }
});

socket.on("player:passwordPanicRejected", (message) => {
  alert(message);
  showScreen("passwordPanicScreen");
});

socket.on("game:passwordPanicFinished", () => {
  passwordPanicMode = "";
  setDoneScreen("Round finished!", "Look at the main screen for the results.");
  showScreen("doneScreen");
});

// DRAWING ROUND STARTED
socket.on("game:drawingStarted", (data) => {
  showScreen("drawingScreen");

  const promptText = document.getElementById("drawingPromptText");
  const messageText = document.getElementById("drawingMessage");
  const submitButton = document.getElementById("submitDrawingButton");

  promptText.innerText =
    "SKETCH STACK\n\n" +
    "Draw this:\n" +
    data.prompt;

  messageText.innerText = "";
  submitButton.disabled = false;

  clearDrawing();
});

// This is here in case we name the server event Sketch Stack later.
socket.on("game:sketchStackStarted", (data) => {
  showScreen("drawingScreen");

  const promptText = document.getElementById("drawingPromptText");
  const messageText = document.getElementById("drawingMessage");
  const submitButton = document.getElementById("submitDrawingButton");

  promptText.innerText =
    "SKETCH STACK\n\n" +
    "Draw this:\n" +
    data.prompt;

  messageText.innerText = "";
  submitButton.disabled = false;

  clearDrawing();
});

socket.on("player:drawingRejected", (message) => {
  alert(message);
  showScreen("drawingScreen");
});

socket.on("game:drawingFinished", () => {
  setDoneScreen("Round finished!", "Look at the main screen for the results.");
  showScreen("doneScreen");
});

socket.on("game:sketchStackFinished", () => {
  setDoneScreen("Round finished!", "Look at the main screen for the results.");
  showScreen("doneScreen");
});

socket.on("game:bowlingStarted", (data) => {
  showScreen("bowlingScreen");

  bowlingCurrentPlayerId = "";
  bowlingCalibrated = false;
  bowlingMotionEnabled = false;
  bowlingHolding = false;
  bowlingThrowInFlight = false;
  bowlingActivePointerId = null;

  resetBowlingMotion();

  document.getElementById("bowlingTitleText").innerText = "BOWLING";
  document.getElementById("bowlingTurnText").innerText = "Getting ready...";
  document.getElementById("bowlingMessage").innerText =
    "First enable motion controls.";

  document.getElementById("bowlingMotionButton").style.display = "block";
  document.getElementById("bowlingCalibrateButton").style.display = "none";
  document.getElementById("bowlingThrowButton").style.display = "block";

  updateBowlingHoldButton();
});

socket.on("game:bowlingTurn", (data) => {
  showScreen("bowlingScreen");

  bowlingCurrentPlayerId = data.currentPlayerId || "";
  bowlingHolding = false;
  bowlingThrowInFlight = false;
  bowlingActivePointerId = null;

  const button = document.getElementById("bowlingThrowButton");
  if (button) {
    button.classList.remove("bowlingHolding");
  }

  const isMyTurn = isMyBowlingTurn();

  document.getElementById("bowlingTurnText").innerText = isMyTurn
    ? "YOUR TURN — HOLD YOUR PHONE LIKE A WII REMOTE"
    : data.currentPlayerName + " is bowling.";

  if (!isMyTurn) {
    document.getElementById("bowlingMessage").innerText =
      "Watch the main screen.";
  } else if (!bowlingMotionEnabled) {
    document.getElementById("bowlingMessage").innerText =
      "Enable motion controls first.";
  } else if (!bowlingCalibrated) {
    document.getElementById("bowlingMessage").innerText =
      "Calibrate your phone first.";
  } else {
    document.getElementById("bowlingMessage").innerText =
      "HOLD the orange button. Unity will follow your swing live. RELEASE to bowl.";
  }

  resetBowlingMotion();
  updateBowlingHoldButton();
});

socket.on("game:bowlingMotionStartAccepted", () => {
  if (bowlingHolding) {
    document.getElementById("bowlingMessage").innerText =
      "LIVE CONTROL ACTIVE — swing while holding, then RELEASE.";
  }
});

socket.on("game:bowlingMotionRejected", (message) => {
  bowlingHolding = false;
  bowlingThrowInFlight = false;

  const button = document.getElementById("bowlingThrowButton");
  if (button) {
    button.classList.remove("bowlingHolding");
  }

  document.getElementById("bowlingMessage").innerText =
    "Motion control stopped: " + message;

  resetBowlingMotion();
  updateBowlingHoldButton();
});

socket.on("game:bowlingThrowAccepted", (data) => {
  if (data.playerId === myPlayerId) {
    bowlingThrowInFlight = true;
    bowlingHolding = false;

    document.getElementById("bowlingMessage").innerText =
      "Nice throw! Watch the lane.";

    updateBowlingHoldButton();
  } else {
    document.getElementById("bowlingMessage").innerText =
      data.playerName + " threw the ball!";
  }
});

socket.on("game:bowlingThrowRejected", (message) => {
  bowlingThrowInFlight = false;
  bowlingHolding = false;

  const button = document.getElementById("bowlingThrowButton");
  if (button) {
    button.classList.remove("bowlingHolding");
  }

  document.getElementById("bowlingMessage").innerText =
    "Throw was not accepted: " + message;

  resetBowlingMotion();
  updateBowlingHoldButton();
});

socket.on("game:returnToLobby", () => {
  resetPhoneToJoinScreen("The host returned to the lobby. Please enter the new room code.");
});

socket.on("game:hostDisconnected", () => {
  resetPhoneToJoinScreen("Host left. Join a new room.");
});

socket.on("player:voteRejected", (message) => {
  alert(message);
  showScreen("voteScreen");
});

socket.on("game:votingFinished", () => {
  setDoneScreen("Round finished!", "Look at the main screen for the results.");
  showScreen("doneScreen");
});

socket.on("game:restarted", () => {
  passwordPanicMode = "";
  setDoneScreen("Game restarted!", "Waiting for the host to start a game.");
  showScreen("waitingScreen");
});
