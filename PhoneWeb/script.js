const socket = io();

let currentRoomCode = "";
let myPlayerId = "";
let passwordPanicMode = "";
let isJoining = false;

let sketchStackCanvas = null;
let sketchStackContext = null;
let sketchStackIsDrawing = false;
let sketchStackLastX = 0;
let sketchStackLastY = 0;

function showScreen(screenId) {
  const screens = [
    "joinScreen",
    "waitingScreen",
    "voteScreen",
    "copycatScreen",
    "hotSeatScreen",
    "passwordPanicScreen",
    "sketchStackPromptScreen",
    "sketchStackDrawingScreen",
    "sketchStackVotingScreen",
    "sketchStackGameOverScreen",
    "doneScreen",
  ];

  screens.forEach((id) => {
    const screen = document.getElementById(id);

    if (screen != null) {
      screen.classList.add("hidden");
    }
  });

  const selectedScreen = document.getElementById(screenId);

  if (selectedScreen != null) {
    selectedScreen.classList.remove("hidden");
  } else {
    console.error("Screen not found:", screenId);
  }
}

function setDoneScreen(title, message) {
  const doneTitle = document.getElementById("doneTitle");
  const doneMessage = document.getElementById("doneMessage");

  if (doneTitle != null) {
    doneTitle.innerText = title;
  }

  if (doneMessage != null) {
    doneMessage.innerText = message;
  }
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

/* ---------------- SKETCH STACK FUNCTIONS ---------------- */

function submitSketchStackPrompt() {
  const promptInput = document.getElementById("sketchStackPromptInput");
  const promptMessage = document.getElementById("sketchStackPromptMessage");

  if (promptInput == null) {
    console.error("sketchStackPromptInput not found");
    return;
  }

  const prompt = promptInput.value.trim();

  if (prompt === "") {
    if (promptMessage != null) {
      promptMessage.innerText = "Type a prompt first.";
    }
    return;
  }

  socket.emit("player:submitSketchStackPrompt", {
    roomCode: currentRoomCode,
    prompt: prompt,
  });

  setDoneScreen("Prompt sent!", "Waiting for everyone else...");
  showScreen("doneScreen");
}

function setupSketchStackCanvas() {
  sketchStackCanvas = document.getElementById("sketchStackCanvas");

  if (sketchStackCanvas == null) {
    console.error("sketchStackCanvas not found");
    return;
  }

  sketchStackContext = sketchStackCanvas.getContext("2d");

  clearSketchStackDrawing();

  sketchStackContext.lineWidth = 5;
  sketchStackContext.lineCap = "round";
  sketchStackContext.lineJoin = "round";
  sketchStackContext.strokeStyle = "black";

  sketchStackCanvas.onmousedown = startSketchStackDrawing;
  sketchStackCanvas.onmousemove = drawSketchStackLine;
  sketchStackCanvas.onmouseup = stopSketchStackDrawing;
  sketchStackCanvas.onmouseleave = stopSketchStackDrawing;

  sketchStackCanvas.ontouchstart = startSketchStackTouchDrawing;
  sketchStackCanvas.ontouchmove = drawSketchStackTouchLine;
  sketchStackCanvas.ontouchend = stopSketchStackDrawing;
  sketchStackCanvas.ontouchcancel = stopSketchStackDrawing;
}

function getCanvasPosition(event) {
  const rect = sketchStackCanvas.getBoundingClientRect();

  const scaleX = sketchStackCanvas.width / rect.width;
  const scaleY = sketchStackCanvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function startSketchStackDrawing(event) {
  if (sketchStackCanvas == null || sketchStackContext == null) {
    return;
  }

  sketchStackIsDrawing = true;

  const position = getCanvasPosition(event);
  sketchStackLastX = position.x;
  sketchStackLastY = position.y;
}

function drawSketchStackLine(event) {
  if (!sketchStackIsDrawing || sketchStackContext == null) {
    return;
  }

  const position = getCanvasPosition(event);

  sketchStackContext.beginPath();
  sketchStackContext.moveTo(sketchStackLastX, sketchStackLastY);
  sketchStackContext.lineTo(position.x, position.y);
  sketchStackContext.stroke();

  sketchStackLastX = position.x;
  sketchStackLastY = position.y;
}

function startSketchStackTouchDrawing(event) {
  event.preventDefault();

  if (event.touches.length <= 0) {
    return;
  }

  startSketchStackDrawing(event.touches[0]);
}

function drawSketchStackTouchLine(event) {
  event.preventDefault();

  if (event.touches.length <= 0) {
    return;
  }

  drawSketchStackLine(event.touches[0]);
}

function stopSketchStackDrawing() {
  sketchStackIsDrawing = false;
}

function clearSketchStackDrawing() {
  if (sketchStackCanvas == null) {
    sketchStackCanvas = document.getElementById("sketchStackCanvas");
  }

  if (sketchStackCanvas == null) {
    return;
  }

  if (sketchStackContext == null) {
    sketchStackContext = sketchStackCanvas.getContext("2d");
  }

  sketchStackContext.fillStyle = "white";
  sketchStackContext.fillRect(0, 0, sketchStackCanvas.width, sketchStackCanvas.height);
}

function submitSketchStackDrawing() {
  if (sketchStackCanvas == null) {
    sketchStackCanvas = document.getElementById("sketchStackCanvas");
  }

  if (sketchStackCanvas == null) {
    const message = document.getElementById("sketchStackDrawingMessage");

    if (message != null) {
      message.innerText = "Drawing area not found.";
    }

    return;
  }

  const drawingDataUrl = sketchStackCanvas.toDataURL("image/png");

  socket.emit("player:submitDrawing", {
    roomCode: currentRoomCode,
    drawingDataUrl: drawingDataUrl,
  });

  setDoneScreen("Drawing sent!", "Waiting for everyone else...");
  showScreen("doneScreen");
}

function voteSketchStackDrawing(playerId) {
  socket.emit("player:submitSketchStackVote", {
    roomCode: currentRoomCode,
    votedPlayerId: playerId,
  });

  setDoneScreen("Vote locked in!", "Waiting for everyone else...");
  showScreen("doneScreen");
}

/* ---------------- SOCKET EVENTS ---------------- */

socket.on("player:joinSuccess", (data) => {
  myPlayerId = data.player.id;
  currentRoomCode = data.roomCode;
  isJoining = false;
  setJoinButtonState(true);

  const joinMessage = document.getElementById("joinMessage");

  if (joinMessage != null) {
    joinMessage.innerText = "";
  }

  showScreen("waitingScreen");
});

socket.on("player:joinFailed", (message) => {
  isJoining = false;
  setJoinButtonState(true);

  const joinMessage = document.getElementById("joinMessage");

  if (joinMessage != null) {
    if (message.includes("Room is full")) {
      joinMessage.innerText = "The room is full";
    } else {
      joinMessage.innerText = message;
    }
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

/* ---------------- SKETCH STACK EVENTS ---------------- */

socket.on("game:sketchStackPromptPhaseStarted", () => {
  const promptInput = document.getElementById("sketchStackPromptInput");
  const promptMessage = document.getElementById("sketchStackPromptMessage");

  if (promptInput != null) {
    promptInput.value = "";
  }

  if (promptMessage != null) {
    promptMessage.innerText = "";
  }

  showScreen("sketchStackPromptScreen");
});

socket.on("player:sketchStackPromptAccepted", () => {
  setDoneScreen("Prompt sent!", "Waiting for the round to start...");
  showScreen("doneScreen");
});

socket.on("player:sketchStackPromptRejected", (message) => {
  alert(message);
  showScreen("sketchStackPromptScreen");
});

socket.on("game:drawingStarted", (data) => {
  showSketchStackDrawingScreen(data);
});

socket.on("game:sketchStackStarted", (data) => {
  showSketchStackDrawingScreen(data);
});

function showSketchStackDrawingScreen(data) {
  showScreen("sketchStackDrawingScreen");

  const promptText = document.getElementById("sketchStackDrawingPromptText");
  const messageText = document.getElementById("sketchStackDrawingMessage");

  if (promptText != null) {
    promptText.innerText =
      "SKETCH STACK\n\n" +
      "Round " +
      data.roundNumber +
      "/" +
      data.maxRounds +
      "\n\nDraw this:\n" +
      data.prompt;
  }

  if (messageText != null) {
    messageText.innerText = "";
  }

  setupSketchStackCanvas();
  clearSketchStackDrawing();
}

socket.on("player:drawingRejected", (message) => {
  alert(message);
  showScreen("sketchStackDrawingScreen");
});

socket.on("game:sketchStackVotingStarted", (data) => {
  showScreen("sketchStackVotingScreen");

  const votingTitle = document.getElementById("sketchStackVotingTitle");
  const drawingsList = document.getElementById("sketchStackVotingList");

  if (votingTitle != null) {
    votingTitle.innerText =
      "Pick the best drawing\nRound " +
      data.roundNumber +
      "/" +
      data.maxRounds;
  }

  if (drawingsList != null) {
    drawingsList.innerHTML = "";

    if (!data.drawings || data.drawings.length === 0) {
      drawingsList.innerHTML = "<p>No drawings to vote for.</p>";
      return;
    }

    data.drawings.forEach((drawing) => {
      const card = document.createElement("div");
      card.className = "drawingVoteCard";

      const image = document.createElement("img");
      image.src = drawing.drawingDataUrl;
      image.className = "drawingVoteImage";

      const button = document.createElement("button");
      button.className = "playerButton";
      button.innerText = "Vote for this drawing";

      button.onclick = () => {
        voteSketchStackDrawing(drawing.playerId);
      };

      card.appendChild(image);
      card.appendChild(button);

      drawingsList.appendChild(card);
    });
  }
});

socket.on("player:sketchStackVoteAccepted", () => {
  setDoneScreen("Vote locked in!", "Waiting for everyone else...");
  showScreen("doneScreen");
});

socket.on("player:sketchStackVoteRejected", (message) => {
  alert(message);
  showScreen("sketchStackVotingScreen");
});

socket.on("game:drawingFinished", () => {
  setDoneScreen("Round finished!", "Look at the main screen for the results.");
  showScreen("doneScreen");
});

socket.on("game:sketchStackFinished", () => {
  setDoneScreen("Round finished!", "Look at the main screen for the results.");
  showScreen("doneScreen");
});

socket.on("game:sketchStackGameOver", (data) => {
  showScreen("sketchStackGameOverScreen");

  const leaderboardList = document.getElementById("sketchStackLeaderboardList");

  if (leaderboardList != null) {
    leaderboardList.innerHTML = "";

    if (!data.leaderboard || data.leaderboard.length === 0) {
      leaderboardList.innerHTML = "<p>No scores yet.</p>";
      return;
    }

    data.leaderboard.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "leaderboardRow";
      row.innerText =
        entry.place +
        ". " +
        entry.playerName +
        " - " +
        entry.score +
        " pts";

      leaderboardList.appendChild(row);
    });
  }
});

/* ---------------- OTHER EVENTS ---------------- */

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
