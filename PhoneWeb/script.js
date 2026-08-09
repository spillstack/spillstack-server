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

let bowlingHolding = false;
let bowlingThrowInFlight = false;
let bowlingActivePointerId = null;


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

  const playerName =
    document.getElementById("nameInput").value.trim();

  const roomCode =
    document.getElementById("roomInput").value.trim();

  if (playerName === "" || roomCode === "") {

    document.getElementById("joinMessage").innerText =
      "Enter your name and room code.";

    return;
  }

  if (playerName.length > 40) {

    document.getElementById("joinMessage").innerText =
      "Name must be 40 characters or less.";

    return;
  }

  isJoining = true;

  setJoinButtonState(false);

  document.getElementById("joinMessage").innerText =
    "Connecting...";

  currentRoomCode = roomCode;

  socket.emit("player:joinRoom", {
    roomCode: roomCode,
    playerName: playerName,
  });
}



// COPYCAT

function submitCopycatAnswer() {

  const answerInput =
    document.getElementById("copycatAnswerInput");

  const answer = answerInput.value.trim();

  if (answer === "") {

    document.getElementById("copycatMessage").innerText =
      "Type an answer first.";

    return;
  }

  socket.emit("player:submitCopycatAnswer", {
    roomCode: currentRoomCode,
    answer: answer,
  });

  setDoneScreen(
    "Answer locked in!",
    "Waiting for everyone else..."
  );

  showScreen("doneScreen");
}



// HOT SEAT

function submitHotSeatAnswer() {

  const answerInput =
    document.getElementById("hotSeatAnswerInput");

  const answer = answerInput.value.trim();

  if (answer === "") {

    document.getElementById("hotSeatMessage").innerText =
      "Type an answer first.";

    return;
  }

  socket.emit("player:submitHotSeatAnswer", {
    roomCode: currentRoomCode,
    answer: answer,
  });

  setDoneScreen(
    "Answer locked in!",
    "Waiting for everyone else..."
  );

  showScreen("doneScreen");
}



function chooseHotSeatWinner(answerOwnerId) {

  socket.emit("player:chooseHotSeatWinner", {
    roomCode: currentRoomCode,
    winnerPlayerId: answerOwnerId,
  });

  setDoneScreen(
    "Winner picked!",
    "Look at the main screen for results."
  );

  showScreen("doneScreen");
}



// PASSWORD PANIC

function submitPasswordPanic() {

  const input =
    document.getElementById("passwordPanicInput");

  const value = input.value.trim();

  if (value === "") {

    document.getElementById("passwordPanicMessage").innerText =
      "Type something first.";

    return;
  }

  if (passwordPanicMode === "clue") {

    socket.emit("player:submitPasswordPanicClue", {
      roomCode: currentRoomCode,
      clue: value,
    });

    setDoneScreen(
      "Clue sent!",
      "Waiting for everyone to guess..."
    );

    showScreen("doneScreen");

    return;
  }

  if (passwordPanicMode === "guess") {

    socket.emit("player:submitPasswordPanicGuess", {
      roomCode: currentRoomCode,
      guess: value,
    });

    setDoneScreen(
      "Guess locked in!",
      "Waiting for everyone else..."
    );

    showScreen("doneScreen");

    return;
  }

  document.getElementById("passwordPanicMessage").innerText =
    "Wait for the game to start.";
}



// DRAWING CODE

function setupDrawingCanvas() {

  drawingCanvas =
    document.getElementById("drawingCanvas");

  if (drawingCanvas == null) {
    return;
  }

  drawingContext =
    drawingCanvas.getContext("2d");

  drawingContext.fillStyle = "white";

  drawingContext.fillRect(
    0,
    0,
    drawingCanvas.width,
    drawingCanvas.height
  );

  drawingContext.lineWidth = 5;
  drawingContext.lineCap = "round";
  drawingContext.lineJoin = "round";
  drawingContext.strokeStyle = "black";

  drawingCanvas.addEventListener(
    "mousedown",
    startDrawing
  );

  drawingCanvas.addEventListener(
    "mousemove",
    draw
  );

  drawingCanvas.addEventListener(
    "mouseup",
    stopDrawing
  );

  drawingCanvas.addEventListener(
    "mouseleave",
    stopDrawing
  );

  drawingCanvas.addEventListener(
    "touchstart",
    startDrawing
  );

  drawingCanvas.addEventListener(
    "touchmove",
    draw
  );

  drawingCanvas.addEventListener(
    "touchend",
    stopDrawing
  );

  drawingCanvas.addEventListener(
    "touchcancel",
    stopDrawing
  );
}



function getCanvasPosition(event) {

  const rect =
    drawingCanvas.getBoundingClientRect();

  let clientX;
  let clientY;

  if (
    event.touches &&
    event.touches.length > 0
  ) {

    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;

  } else {

    clientX = event.clientX;
    clientY = event.clientY;
  }

  const scaleX =
    drawingCanvas.width / rect.width;

  const scaleY =
    drawingCanvas.height / rect.height;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}



function startDrawing(event) {

  event.preventDefault();

  if (
    drawingCanvas == null ||
    drawingContext == null
  ) {
    return;
  }

  isDrawing = true;

  const position =
    getCanvasPosition(event);

  drawingContext.beginPath();

  drawingContext.moveTo(
    position.x,
    position.y
  );
}



function draw(event) {

  event.preventDefault();

  if (!isDrawing) {
    return;
  }

  if (
    drawingCanvas == null ||
    drawingContext == null
  ) {
    return;
  }

  const position =
    getCanvasPosition(event);

  drawingContext.lineTo(
    position.x,
    position.y
  );

  drawingContext.stroke();
}



function stopDrawing(event) {

  if (event) {
    event.preventDefault();
  }

  isDrawing = false;
}



function clearDrawing() {

  if (
    drawingCanvas == null ||
    drawingContext == null
  ) {
    return;
  }

  drawingContext.fillStyle = "white";

  drawingContext.fillRect(
    0,
    0,
    drawingCanvas.width,
    drawingCanvas.height
  );

  drawingContext.lineWidth = 5;
  drawingContext.lineCap = "round";
  drawingContext.lineJoin = "round";
  drawingContext.strokeStyle = "black";

  document.getElementById("drawingMessage").innerText =
    "";
}



function submitDrawing() {

  if (drawingCanvas == null) {

    document.getElementById("drawingMessage").innerText =
      "Drawing canvas not ready.";

    return;
  }

  const drawingDataUrl =
    drawingCanvas.toDataURL("image/png");

  socket.emit("player:submitDrawing", {
    roomCode: currentRoomCode,
    drawingDataUrl: drawingDataUrl,
  });

  setDoneScreen(
    "Drawing locked in!",
    "Waiting for everyone else..."
  );

  showScreen("doneScreen");
}



// =====================================
// BOWLING
// =====================================

function resetBowlingMotion() {

  bowlingPeakForward = 0;
  bowlingPeakSide = 0;
  bowlingPeakSpin = 0;
  bowlingLastMotionTime = 0;
}



function isMyBowlingTurn() {

  return (
    bowlingCurrentPlayerId !== "" &&
    bowlingCurrentPlayerId === myPlayerId
  );
}



function updateBowlingHoldButton() {

  const button =
    document.getElementById("bowlingThrowButton");

  if (!button) {
    return;
  }

  const canBowl =
    bowlingMotionEnabled &&
    bowlingCalibrated &&
    isMyBowlingTurn() &&
    !bowlingThrowInFlight &&
    !bowlingHolding;

  button.disabled = !canBowl;

  if (bowlingThrowInFlight) {

    button.innerText =
      "THROW SENT!";

  } else if (bowlingHolding) {

    button.innerText =
      "SWING... RELEASE TO THROW";

  } else {

    button.innerText =
      "HOLD TO BOWL";
  }
}



function handleBowlingMotion(event) {

  if (
    !bowlingListening ||
    !bowlingMotionEnabled ||
    !bowlingCalibrated ||
    !bowlingHolding
  ) {
    return;
  }

  const acceleration =
    event.accelerationIncludingGravity ||
    event.acceleration;

  const rotation =
    event.rotationRate;

  if (!acceleration) {
    return;
  }

  const z =
    Number(acceleration.z) || 0;

  const x =
    Number(acceleration.x) || 0;


  const forward =
    Math.max(
      0,
      Math.min(
        1,
        Math.abs(
          z - bowlingBaselineZ
        ) / 18
      )
    );


  const side =
    Math.max(
      -1,
      Math.min(
        1,
        (x - bowlingBaselineX) / 12
      )
    );


  const spin = rotation
    ? Math.max(
        -1,
        Math.min(
          1,
          (Number(rotation.gamma) || 0) / 180
        )
      )
    : 0;


  bowlingPeakForward =
    Math.max(
      bowlingPeakForward,
      forward
    );


  if (
    Math.abs(side) >
    Math.abs(bowlingPeakSide)
  ) {

    bowlingPeakSide =
      side;
  }


  if (
    Math.abs(spin) >
    Math.abs(bowlingPeakSpin)
  ) {

    bowlingPeakSpin =
      spin;
  }


  bowlingLastMotionTime =
    Date.now();
}



async function enableBowlingMotion() {

  const message =
    document.getElementById("bowlingMessage");


  try {

    if (
      typeof DeviceMotionEvent === "undefined"
    ) {

      message.innerText =
        "This phone does not provide motion controls.";

      return;
    }


    if (
      typeof DeviceMotionEvent.requestPermission ===
      "function"
    ) {

      const permission =
        await DeviceMotionEvent.requestPermission();


      if (permission !== "granted") {

        message.innerText =
          "Motion permission was denied.";

        return;
      }
    }


    if (!bowlingListening) {

      window.addEventListener(
        "devicemotion",
        handleBowlingMotion,
        true
      );

      bowlingListening = true;
    }


    bowlingMotionEnabled = true;


    message.innerText =
      "Motion controls enabled. Hold your phone still for a second, then press CALIBRATE.";


    document.getElementById(
      "bowlingMotionButton"
    ).style.display = "none";


    document.getElementById(
      "bowlingCalibrateButton"
    ).style.display = "block";


    updateBowlingHoldButton();

  } catch (error) {

    console.error(error);

    message.innerText =
      "Could not enable motion controls.";
  }
}



function calibrateBowlingPhone() {

  const message =
    document.getElementById("bowlingMessage");

  const acceleration =
    window.__lastBowlingAcceleration;


  if (!acceleration) {

    message.innerText =
      "Motion data is not ready yet. Hold the phone still for a second and tap CALIBRATE again.";

    return;
  }


  bowlingBaselineX =
    Number(acceleration.x) || 0;

  bowlingBaselineY =
    Number(acceleration.y) || 0;

  bowlingBaselineZ =
    Number(acceleration.z) || 0;


  bowlingCalibrated = true;

  bowlingThrowInFlight = false;

  bowlingHolding = false;


  resetBowlingMotion();


  document.getElementById(
    "bowlingCalibrateButton"
  ).style.display = "none";


  message.innerText =
    isMyBowlingTurn()

      ? "Ready! HOLD the orange button, swing forward, then RELEASE it."

      : "Calibrated. Wait for your turn.";


  updateBowlingHoldButton();
}



function beginBowlingHold(event) {

  if (event) {
    event.preventDefault();
  }


  const button =
    document.getElementById("bowlingThrowButton");

  const message =
    document.getElementById("bowlingMessage");


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

    message.innerText =
      "Connection lost. Wait for the phone to reconnect.";

    return;
  }


  bowlingHolding = true;


  resetBowlingMotion();


  if (
    event &&
    event.pointerId !== undefined &&
    button &&
    button.setPointerCapture
  ) {

    bowlingActivePointerId =
      event.pointerId;


    try {

      button.setPointerCapture(
        event.pointerId
      );

    } catch (error) {

    }
  }


  if (button) {

    button.classList.add(
      "bowlingHolding"
    );
  }


  message.innerText =
    "KEEP HOLDING — swing your phone forward, then RELEASE the button.";


  updateBowlingHoldButton();
}



function finishBowlingHold(event) {

  if (event) {
    event.preventDefault();
  }


  if (!bowlingHolding) {
    return;
  }


  const button =
    document.getElementById("bowlingThrowButton");

  const message =
    document.getElementById("bowlingMessage");


  bowlingHolding = false;


  if (button) {

    button.classList.remove(
      "bowlingHolding"
    );


    if (
      bowlingActivePointerId !== null &&
      button.hasPointerCapture &&
      button.hasPointerCapture(
        bowlingActivePointerId
      )
    ) {

      try {

        button.releasePointerCapture(
          bowlingActivePointerId
        );

      } catch (error) {

      }
    }
  }


  bowlingActivePointerId = null;


  if (
    !bowlingCalibrated ||
    !isMyBowlingTurn()
  ) {

    message.innerText =
      "Your turn ended before the throw was sent.";

    updateBowlingHoldButton();

    return;
  }


  if (!socket.connected) {

    message.innerText =
      "Connection lost. Throw was not sent.";

    updateBowlingHoldButton();

    return;
  }


  const power =
    Math.max(
      0.25,
      Math.min(
        1,
        bowlingPeakForward
      )
    );


  const side =
    Math.max(
      -1,
      Math.min(
        1,
        bowlingPeakSide
      )
    );


  const spin =
    Math.max(
      -1,
      Math.min(
        1,
        bowlingPeakSpin
      )
    );


  bowlingThrowInFlight = true;


  socket.emit(
    "player:bowlingThrow",
    {
      roomCode: currentRoomCode,
      forward: power,
      side: side,
      spin: spin,
      power: power,
    }
  );


  console.log(
    "Bowling throw sent:",
    {
      power,
      side,
      spin,
    }
  );


  message.innerText =
    "THROW SENT! Watch the bowling lane.";


  updateBowlingHoldButton();

  resetBowlingMotion();
}



function setupBowlingHoldButton() {

  const button =
    document.getElementById("bowlingThrowButton");


  if (!button) {
    return;
  }


  if (window.PointerEvent) {

    button.addEventListener(
      "pointerdown",
      beginBowlingHold
    );


    button.addEventListener(
      "pointerup",
      finishBowlingHold
    );


    button.addEventListener(
      "pointercancel",
      finishBowlingHold
    );

  } else {

    button.addEventListener(
      "touchstart",
      beginBowlingHold,
      {
        passive: false
      }
    );


    button.addEventListener(
      "touchend",
      finishBowlingHold,
      {
        passive: false
      }
    );


    button.addEventListener(
      "touchcancel",
      finishBowlingHold,
      {
        passive: false
      }
    );


    button.addEventListener(
      "mousedown",
      beginBowlingHold
    );


    button.addEventListener(
      "mouseup",
      finishBowlingHold
    );
  }


  button.addEventListener(
    "contextmenu",
    (event) => {

      event.preventDefault();

    }
  );


  updateBowlingHoldButton();
}



// KEEP LAST PHONE MOTION FOR CALIBRATION

window.addEventListener(
  "devicemotion",

  (event) => {

    const acceleration =
      event.accelerationIncludingGravity ||
      event.acceleration;


    if (acceleration) {

      window.__lastBowlingAcceleration =
        acceleration;
    }
  },

  true
);



// PAGE LOADED

window.addEventListener(
  "load",

  () => {

    setupDrawingCanvas();

    setupBowlingHoldButton();

  }
);



// PLAYER JOIN

socket.on(
  "player:joinSuccess",

  (data) => {

    myPlayerId =
      data.player.id;

    currentRoomCode =
      data.roomCode;

    isJoining = false;


    setJoinButtonState(true);


    document.getElementById(
      "joinMessage"
    ).innerText = "";


    showScreen(
      "waitingScreen"
    );
  }
);



socket.on(
  "player:joinFailed",

  (message) => {

    isJoining = false;

    setJoinButtonState(true);


    const joinMessage =
      document.getElementById(
        "joinMessage"
      );


    if (
      message.includes(
        "Room is full"
      )
    ) {

      joinMessage.innerText =
        "The room is full";

    } else {

      joinMessage.innerText =
        message;
    }


    showScreen(
      "joinScreen"
    );
  }
);



socket.on(
  "game:roomClosed",

  (data) => {

    const message =
      data &&
      data.message

        ? data.message

        : "The game ended. Please enter the new room code.";


    resetPhoneToJoinScreen(
      message
    );
  }
);



// OLD VOTE GAME

socket.on(
  "game:questionStarted",

  (data) => {

    showScreen(
      "voteScreen"
    );


    document.getElementById(
      "questionText"
    ).innerText =
      data.question;


    const playersList =
      document.getElementById(
        "playersList"
      );


    playersList.innerHTML =
      "";


    let voteOptions = 0;


    data.players.forEach(
      (player) => {

        if (
          player.id ===
          myPlayerId
        ) {

          return;
        }


        voteOptions++;


        const button =
          document.createElement(
            "button"
          );


        button.className =
          "playerButton";


        button.innerText =
          player.name;


        button.onclick =
          () => {

            socket.emit(
              "player:submitVote",
              {
                roomCode:
                  currentRoomCode,

                votedPlayerId:
                  player.id,
              }
            );


            setDoneScreen(
              "Vote locked in!",
              "Waiting for everyone else..."
            );


            showScreen(
              "doneScreen"
            );
          };


        playersList.appendChild(
          button
        );
      }
    );


    if (
      voteOptions === 0
    ) {

      playersList.innerHTML =
        "<p>You need at least 2 players to vote.</p>";
    }
  }
);



// COPYCAT START

socket.on(
  "game:copycatStarted",

  (data) => {

    showScreen(
      "copycatScreen"
    );


    const promptText =
      document.getElementById(
        "copycatPromptText"
      );


    const answerInput =
      document.getElementById(
        "copycatAnswerInput"
      );


    const messageText =
      document.getElementById(
        "copycatMessage"
      );


    answerInput.value =
      "";

    messageText.innerText =
      "";


    if (
      data.targetPlayerId ===
      myPlayerId
    ) {

      promptText.innerText =
        "COPYCAT\n\n" +
        "You are the target player.\n\n" +
        "Prompt:\n" +
        data.prompt +
        "\n\nType your real answer.";


      answerInput.placeholder =
        "Type your answer";

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


      answerInput.placeholder =
        "Type your guess";
    }
  }
);



socket.on(
  "player:copycatAnswerRejected",

  (message) => {

    alert(message);

    showScreen(
      "copycatScreen"
    );
  }
);



socket.on(
  "game:copycatFinished",

  () => {

    setDoneScreen(
      "Round finished!",
      "Look at the main screen for the results."
    );


    showScreen(
      "doneScreen"
    );
  }
);



// HOT SEAT

socket.on(
  "game:hotSeatStarted",

  (data) => {

    showScreen(
      "hotSeatScreen"
    );


    const promptText =
      document.getElementById(
        "hotSeatPromptText"
      );


    const answerInput =
      document.getElementById(
        "hotSeatAnswerInput"
      );


    const submitButton =
      document.getElementById(
        "hotSeatSubmitButton"
      );


    const answersList =
      document.getElementById(
        "hotSeatAnswersList"
      );


    const messageText =
      document.getElementById(
        "hotSeatMessage"
      );


    answerInput.value =
      "";

    answersList.innerHTML =
      "";

    messageText.innerText =
      "";


    if (
      data.hotSeatPlayerId ===
      myPlayerId
    ) {

      promptText.innerText =
        "HOT SEAT\n\n" +
        "You are in the Hot Seat.\n\n" +
        "Prompt:\n" +
        data.prompt +
        "\n\nWait for everyone to submit answers. Then you will pick the winner.";


      answerInput.style.display =
        "none";


      submitButton.style.display =
        "none";

    } else {

      promptText.innerText =
        "HOT SEAT\n\n" +
        data.hotSeatPlayerName +
        " is in the Hot Seat.\n\n" +
        "Prompt:\n" +
        data.prompt +
        "\n\nType a funny answer.";


      answerInput.style.display =
        "block";


      submitButton.style.display =
        "block";


      answerInput.placeholder =
        "Type your answer";
    }
  }
);



socket.on(
  "game:hotSeatChooseWinner",

  (data) => {

    showScreen(
      "hotSeatScreen"
    );


    const promptText =
      document.getElementById(
        "hotSeatPromptText"
      );


    const answerInput =
      document.getElementById(
        "hotSeatAnswerInput"
      );


    const submitButton =
      document.getElementById(
        "hotSeatSubmitButton"
      );


    const answersList =
      document.getElementById(
        "hotSeatAnswersList"
      );


    const messageText =
      document.getElementById(
        "hotSeatMessage"
      );


    answerInput.style.display =
      "none";


    submitButton.style.display =
      "none";


    answersList.innerHTML =
      "";


    messageText.innerText =
      "";


    if (
      data.hotSeatPlayerId ===
      myPlayerId
    ) {

      promptText.innerText =
        "HOT SEAT\n\nPick your favourite answer.";


      data.answers.forEach(
        (answerData) => {

          const button =
            document.createElement(
              "button"
            );


          button.className =
            "playerButton";


          button.innerText =
            answerData.answer;


          button.onclick =
            () => {

              chooseHotSeatWinner(
                answerData.playerId
              );
            };


          answersList.appendChild(
            button
          );
        }
      );

    } else {

      setDoneScreen(
        "Answers are in!",
        "Waiting for the Hot Seat player to pick."
      );


      showScreen(
        "doneScreen"
      );
    }
  }
);



socket.on(
  "player:hotSeatAnswerRejected",

  (message) => {

    alert(message);

    showScreen(
      "hotSeatScreen"
    );
  }
);



socket.on(
  "game:hotSeatFinished",

  () => {

    setDoneScreen(
      "Round finished!",
      "Look at the main screen for the results."
    );


    showScreen(
      "doneScreen"
    );
  }
);



// PASSWORD PANIC

socket.on(
  "game:passwordPanicStarted",

  (data) => {

    showScreen(
      "passwordPanicScreen"
    );


    const titleText =
      document.getElementById(
        "passwordPanicTitleText"
      );


    const infoText =
      document.getElementById(
        "passwordPanicInfoText"
      );


    const input =
      document.getElementById(
        "passwordPanicInput"
      );


    const submitButton =
      document.getElementById(
        "passwordPanicSubmitButton"
      );


    const messageText =
      document.getElementById(
        "passwordPanicMessage"
      );


    input.value =
      "";


    messageText.innerText =
      "";


    input.style.display =
      "block";


    submitButton.style.display =
      "block";


    if (
      data.clueGiverId ===
      myPlayerId
    ) {

      passwordPanicMode =
        "clue";


      titleText.innerText =
        "PASSWORD PANIC";


      infoText.innerText =
        "You are the clue giver.\n\n" +
        "Secret word:\n" +
        data.secretWord +
        "\n\nType ONE clue to help everyone guess it.";


      input.placeholder =
        "Type your clue";

    } else {

      passwordPanicMode =
        "";


      titleText.innerText =
        "PASSWORD PANIC";


      infoText.innerText =
        data.clueGiverName +
        " is the clue giver.\n\n" +
        "Waiting for them to give a clue...";


      input.style.display =
        "none";


      submitButton.style.display =
        "none";
    }
  }
);



socket.on(
  "game:passwordPanicClueGiven",

  (data) => {

    showScreen(
      "passwordPanicScreen"
    );


    const titleText =
      document.getElementById(
        "passwordPanicTitleText"
      );


    const infoText =
      document.getElementById(
        "passwordPanicInfoText"
      );


    const input =
      document.getElementById(
        "passwordPanicInput"
      );


    const submitButton =
      document.getElementById(
        "passwordPanicSubmitButton"
      );


    const messageText =
      document.getElementById(
        "passwordPanicMessage"
      );


    input.value =
      "";


    messageText.innerText =
      "";


    if (
      data.clueGiverId ===
      myPlayerId
    ) {

      passwordPanicMode =
        "";


      titleText.innerText =
        "PASSWORD PANIC";


      infoText.innerText =
        "Your clue:\n" +
        data.clue +
        "\n\nWaiting for everyone to guess...";


      input.style.display =
        "none";


      submitButton.style.display =
        "none";

    } else {

      passwordPanicMode =
        "guess";


      titleText.innerText =
        "PASSWORD PANIC";


      infoText.innerText =
        "Clue:\n" +
        data.clue +
        "\n\nGuess the secret word.";


      input.style.display =
        "block";


      submitButton.style.display =
        "block";


      input.placeholder =
        "Type your guess";
    }
  }
);



socket.on(
  "player:passwordPanicRejected",

  (message) => {

    alert(message);

    showScreen(
      "passwordPanicScreen"
    );
  }
);



socket.on(
  "game:passwordPanicFinished",

  () => {

    passwordPanicMode =
      "";


    setDoneScreen(
      "Round finished!",
      "Look at the main screen for the results."
    );


    showScreen(
      "doneScreen"
    );
  }
);



// DRAWING

socket.on(
  "game:drawingStarted",

  (data) => {

    showScreen(
      "drawingScreen"
    );


    const promptText =
      document.getElementById(
        "drawingPromptText"
      );


    const messageText =
      document.getElementById(
        "drawingMessage"
      );


    const submitButton =
      document.getElementById(
        "submitDrawingButton"
      );


    promptText.innerText =
      "SKETCH STACK\n\n" +
      "Draw this:\n" +
      data.prompt;


    messageText.innerText =
      "";


    submitButton.disabled =
      false;


    clearDrawing();
  }
);



socket.on(
  "game:sketchStackStarted",

  (data) => {

    showScreen(
      "drawingScreen"
    );


    const promptText =
      document.getElementById(
        "drawingPromptText"
      );


    const messageText =
      document.getElementById(
        "drawingMessage"
      );


    const submitButton =
      document.getElementById(
        "submitDrawingButton"
      );


    promptText.innerText =
      "SKETCH STACK\n\n" +
      "Draw this:\n" +
      data.prompt;


    messageText.innerText =
      "";


    submitButton.disabled =
      false;


    clearDrawing();
  }
);



socket.on(
  "player:drawingRejected",

  (message) => {

    alert(message);

    showScreen(
      "drawingScreen"
    );
  }
);



socket.on(
  "game:drawingFinished",

  () => {

    setDoneScreen(
      "Round finished!",
      "Look at the main screen for the results."
    );


    showScreen(
      "doneScreen"
    );
  }
);



socket.on(
  "game:sketchStackFinished",

  () => {

    setDoneScreen(
      "Round finished!",
      "Look at the main screen for the results."
    );


    showScreen(
      "doneScreen"
    );
  }
);



// =====================================
// BOWLING SERVER EVENTS
// =====================================

socket.on(
  "game:bowlingStarted",

  (data) => {

    showScreen(
      "bowlingScreen"
    );


    bowlingCurrentPlayerId =
      "";


    bowlingCalibrated =
      false;


    bowlingMotionEnabled =
      false;


    bowlingHolding =
      false;


    bowlingThrowInFlight =
      false;


    bowlingActivePointerId =
      null;


    resetBowlingMotion();


    document.getElementById(
      "bowlingTitleText"
    ).innerText =
      "BOWLING";


    document.getElementById(
      "bowlingTurnText"
    ).innerText =
      "Getting ready...";


    document.getElementById(
      "bowlingMessage"
    ).innerText =
      "First enable motion controls.";


    document.getElementById(
      "bowlingMotionButton"
    ).style.display =
      "block";


    document.getElementById(
      "bowlingCalibrateButton"
    ).style.display =
      "none";


    document.getElementById(
      "bowlingThrowButton"
    ).style.display =
      "block";


    updateBowlingHoldButton();
  }
);



socket.on(
  "game:bowlingTurn",

  (data) => {

    showScreen(
      "bowlingScreen"
    );


    bowlingCurrentPlayerId =
      data.currentPlayerId ||
      "";


    bowlingHolding =
      false;


    bowlingThrowInFlight =
      false;


    bowlingActivePointerId =
      null;


    const button =
      document.getElementById(
        "bowlingThrowButton"
      );


    if (button) {

      button.classList.remove(
        "bowlingHolding"
      );
    }


    const isMyTurn =
      isMyBowlingTurn();


    document.getElementById(
      "bowlingTurnText"
    ).innerText =
      isMyTurn

        ? "YOUR TURN — HOLD YOUR PHONE LIKE A WII REMOTE"

        : data.currentPlayerName +
          " is bowling.";


    if (!isMyTurn) {

      document.getElementById(
        "bowlingMessage"
      ).innerText =
        "Watch the main screen.";

    } else if (
      !bowlingMotionEnabled
    ) {

      document.getElementById(
        "bowlingMessage"
      ).innerText =
        "Enable motion controls first.";

    } else if (
      !bowlingCalibrated
    ) {

      document.getElementById(
        "bowlingMessage"
      ).innerText =
        "Calibrate your phone first.";

    } else {

      document.getElementById(
        "bowlingMessage"
      ).innerText =
        "HOLD the orange button, swing forward, then RELEASE to bowl.";
    }


    resetBowlingMotion();

    updateBowlingHoldButton();
  }
);



socket.on(
  "game:bowlingThrowAccepted",

  (data) => {

    if (
      data.playerId ===
      myPlayerId
    ) {

      bowlingThrowInFlight =
        true;


      bowlingHolding =
        false;


      document.getElementById(
        "bowlingMessage"
      ).innerText =
        "Nice throw! Watch the lane.";


      updateBowlingHoldButton();

    } else {

      document.getElementById(
        "bowlingMessage"
      ).innerText =
        data.playerName +
        " threw the ball!";
    }
  }
);



socket.on(
  "game:bowlingThrowRejected",

  (message) => {

    bowlingThrowInFlight =
      false;


    bowlingHolding =
      false;


    const button =
      document.getElementById(
        "bowlingThrowButton"
      );


    if (button) {

      button.classList.remove(
        "bowlingHolding"
      );
    }


    document.getElementById(
      "bowlingMessage"
    ).innerText =
      "Throw was not accepted: " +
      message;


    updateBowlingHoldButton();
  }
);



// RETURN TO LOBBY

socket.on(
  "game:returnToLobby",

  () => {

    resetPhoneToJoinScreen(
      "The host returned to the lobby. Please enter the new room code."
    );
  }
);



socket.on(
  "game:hostDisconnected",

  () => {

    resetPhoneToJoinScreen(
      "Host left. Join a new room."
    );
  }
);



socket.on(
  "player:voteRejected",

  (message) => {

    alert(message);

    showScreen(
      "voteScreen"
    );
  }
);



socket.on(
  "game:votingFinished",

  () => {

    setDoneScreen(
      "Round finished!",
      "Look at the main screen for the results."
    );


    showScreen(
      "doneScreen"
    );
  }
);



socket.on(
  "game:restarted",

  () => {

    passwordPanicMode =
      "";


    setDoneScreen(
      "Game restarted!",
      "Waiting for the host to start a game."
    );


    showScreen(
      "waitingScreen"
    );
  }
);
