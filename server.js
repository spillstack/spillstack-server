const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { WebSocketServer } = require("ws");

const app = express();
app.use(cors());

app.use(express.static("PhoneWeb"));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const wss = new WebSocketServer({ server, path: "/unity" });

const rooms = {};
const unityHosts = {};

const MAX_PLAYERS_PER_ROOM = 5;
const MAX_DRAWING_DATA_LENGTH = 1500000;

function makeRoomCode() {
  let roomCode = Math.floor(1000 + Math.random() * 9000).toString();

  while (rooms[roomCode]) {
    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
  }

  return roomCode;
}

function makeNewRoomObject() {
  return {
    players: [],
    currentQuestion: null,
    votes: {},

    currentCopycatPrompt: null,
    copycatAnswers: {},
    copycatTargetPlayerId: null,
    copycatTargetIndex: 0,
    copycatRoundFinished: false,

    currentHotSeatPrompt: null,
    hotSeatAnswers: {},
    hotSeatPlayerId: null,
    hotSeatPlayerIndex: 0,
    hotSeatRoundFinished: false,

    currentPasswordPanicWord: null,
    currentPasswordPanicClue: null,
    passwordPanicGuesses: {},
    passwordPanicClueGiverId: null,
    passwordPanicClueGiverIndex: 0,
    passwordPanicRoundFinished: false,

    currentDrawingPrompt: null,
    drawings: {},
    drawingRoundFinished: false,
  };
}

function createRoomForUnity(ws) {
  const roomCode = makeRoomCode();

  rooms[roomCode] = makeNewRoomObject();
  unityHosts[roomCode] = ws;
  ws.roomCode = roomCode;

  ws.send(
    JSON.stringify({
      type: "roomCreated",
      roomCode: roomCode,
    })
  );

  console.log("Unity room created:", roomCode);
}

function closeRoomAndCreateNewRoom(ws, oldRoomCode, reasonMessage) {
  const room = rooms[oldRoomCode];

  if (room) {
    io.to(oldRoomCode).emit("game:roomClosed", {
      message: reasonMessage || "The game ended. Please enter the new room code.",
    });

    io.in(oldRoomCode).socketsLeave(oldRoomCode);

    delete rooms[oldRoomCode];
    delete unityHosts[oldRoomCode];

    console.log("Closed old room:", oldRoomCode);
  }

  createRoomForUnity(ws);
}

function sendToUnity(roomCode, message) {
  const unitySocket = unityHosts[roomCode];

  if (unitySocket && unitySocket.readyState === unitySocket.OPEN) {
    unitySocket.send(JSON.stringify(message));
  }
}

function cleanAnswer(answer) {
  return answer.trim().toLowerCase();
}

function getPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function getPlayerName(room, playerId) {
  const player = getPlayer(room, playerId);
  return player ? player.name : "Unknown Player";
}

function resetScores(room) {
  room.players.forEach((player) => {
    player.score = 0;
  });
}

function addScores(room) {
  const voteCounts = {};

  for (const voterId in room.votes) {
    const votedPlayerId = room.votes[voterId];
    voteCounts[votedPlayerId] = (voteCounts[votedPlayerId] || 0) + 1;
  }

  let highestVotes = 0;

  for (const playerId in voteCounts) {
    if (voteCounts[playerId] > highestVotes) {
      highestVotes = voteCounts[playerId];
    }
  }

  if (highestVotes === 0) {
    return voteCounts;
  }

  room.players.forEach((player) => {
    const votes = voteCounts[player.id] || 0;

    if (votes === highestVotes) {
      player.score += 1000;
    }
  });

  return voteCounts;
}

function makeCopycatResultText(room) {
  const targetPlayer = getPlayer(room, room.copycatTargetPlayerId);
  const targetName = targetPlayer ? targetPlayer.name : "Unknown Player";
  const targetAnswer = room.copycatAnswers[room.copycatTargetPlayerId] || "No answer";
  const cleanTargetAnswer = cleanAnswer(targetAnswer);

  let correctGuessers = [];
  let allGuessesText = "";

  allGuessesText += "- " + targetName + ": " + targetAnswer + " TARGET\n";

  room.players.forEach((player) => {
    if (player.id === room.copycatTargetPlayerId) {
      return;
    }

    const guess = room.copycatAnswers[player.id] || "No answer";
    const isCorrect = cleanAnswer(guess) === cleanTargetAnswer && guess !== "No answer";

    if (isCorrect) {
      correctGuessers.push(player.id);
      allGuessesText += "- " + player.name + ": " + guess + " CORRECT\n";
    } else {
      allGuessesText += "- " + player.name + ": " + guess + "\n";
    }
  });

  correctGuessers.forEach((playerId) => {
    const player = getPlayer(room, playerId);

    if (player) {
      player.score += 1000;
    }
  });

  if (correctGuessers.length > 0 && targetPlayer) {
    targetPlayer.score += 500;
  }

  let correctText = "";

  if (correctGuessers.length > 0) {
    correctGuessers.forEach((playerId) => {
      correctText += "- " + getPlayerName(room, playerId) + "\n";
    });
  } else {
    correctText = "Nobody guessed it.\n";
  }

  const resultText =
    "COPYCAT RESULTS\n\n" +
    "Target Player:\n" +
    targetName +
    "\n\n" +
    "Answer Was:\n" +
    targetAnswer +
    "\n\n" +
    "Correct Guessers:\n" +
    correctText +
    "\nAll Guesses:\n" +
    allGuessesText;

  return {
    resultText,
    correctGuessers,
    targetName,
    targetAnswer,
  };
}

function finishCopycatRound(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  if (room.copycatRoundFinished === true) {
    return;
  }

  room.copycatRoundFinished = true;

  const resultData = makeCopycatResultText(room);

  sendToUnity(roomCode, {
    type: "copycatResults",
    prompt: room.currentCopycatPrompt,
    targetPlayerId: room.copycatTargetPlayerId,
    targetPlayerName: resultData.targetName,
    targetAnswer: resultData.targetAnswer,
    resultText: resultData.resultText,
    players: room.players,
    answers: room.copycatAnswers,
  });

  io.to(roomCode).emit("game:copycatFinished");

  console.log("Copycat result:", resultData.resultText);
  console.log("Scores:", room.players);
}

function sendHotSeatChooseWinner(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  const answers = [];

  for (const playerId in room.hotSeatAnswers) {
    answers.push({
      playerId,
      answer: room.hotSeatAnswers[playerId],
    });
  }

  if (answers.length === 0) {
    finishHotSeatRound(roomCode, null);
    return;
  }

  io.to(roomCode).emit("game:hotSeatChooseWinner", {
    prompt: room.currentHotSeatPrompt,
    hotSeatPlayerId: room.hotSeatPlayerId,
    hotSeatPlayerName: getPlayerName(room, room.hotSeatPlayerId),
    answers,
  });

  sendToUnity(roomCode, {
    type: "hotSeatChoosingWinner",
    prompt: room.currentHotSeatPrompt,
    hotSeatPlayerId: room.hotSeatPlayerId,
    hotSeatPlayerName: getPlayerName(room, room.hotSeatPlayerId),
    totalAnswers: answers.length,
  });
}

function finishHotSeatRound(roomCode, winnerPlayerId) {
  const room = rooms[roomCode];

  if (!room) return;

  if (room.hotSeatRoundFinished === true) {
    return;
  }

  room.hotSeatRoundFinished = true;

  const hotSeatPlayer = getPlayer(room, room.hotSeatPlayerId);
  const winner = winnerPlayerId ? getPlayer(room, winnerPlayerId) : null;

  let winningAnswer = "No winner";
  let answersText = "";

  if (winner) {
    winner.score += 1000;
    winningAnswer = room.hotSeatAnswers[winnerPlayerId] || "No answer";
  }

  room.players.forEach((player) => {
    if (player.id === room.hotSeatPlayerId) {
      return;
    }

    const answer = room.hotSeatAnswers[player.id] || "No answer";

    if (winner && player.id === winnerPlayerId) {
      answersText += "- " + player.name + ": " + answer + " WINNER\n";
    } else {
      answersText += "- " + player.name + ": " + answer + "\n";
    }
  });

  const resultText =
    "HOT SEAT RESULTS\n\n" +
    "Hot Seat Player:\n" +
    (hotSeatPlayer ? hotSeatPlayer.name : "Unknown Player") +
    "\n\n" +
    "Winning Answer:\n" +
    winningAnswer +
    "\n\n" +
    "Winner:\n" +
    (winner ? winner.name : "No winner") +
    "\n\n" +
    "All Answers:\n" +
    answersText;

  sendToUnity(roomCode, {
    type: "hotSeatResults",
    prompt: room.currentHotSeatPrompt,
    hotSeatPlayerId: room.hotSeatPlayerId,
    hotSeatPlayerName: hotSeatPlayer ? hotSeatPlayer.name : "Unknown Player",
    winnerPlayerId: winnerPlayerId || "",
    winnerPlayerName: winner ? winner.name : "No winner",
    winningAnswer,
    resultText,
    players: room.players,
    answers: room.hotSeatAnswers,
  });

  io.to(roomCode).emit("game:hotSeatFinished");

  console.log("Hot Seat result:", resultText);
  console.log("Scores:", room.players);
}

function finishPasswordPanicRound(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  if (room.passwordPanicRoundFinished === true) {
    return;
  }

  room.passwordPanicRoundFinished = true;

  const secretWord = room.currentPasswordPanicWord || "";
  const cleanSecret = cleanAnswer(secretWord);
  const clueGiver = getPlayer(room, room.passwordPanicClueGiverId);

  let correctGuessers = [];
  let allGuessesText = "";

  room.players.forEach((player) => {
    if (player.id === room.passwordPanicClueGiverId) {
      return;
    }

    const guess = room.passwordPanicGuesses[player.id] || "No answer";
    const isCorrect = cleanAnswer(guess) === cleanSecret && guess !== "No answer";

    if (isCorrect) {
      correctGuessers.push(player.id);
      allGuessesText += "- " + player.name + ": " + guess + " CORRECT\n";
    } else {
      allGuessesText += "- " + player.name + ": " + guess + "\n";
    }
  });

  correctGuessers.forEach((playerId) => {
    const player = getPlayer(room, playerId);

    if (player) {
      player.score += 1000;
    }
  });

  if (correctGuessers.length > 0 && clueGiver) {
    clueGiver.score += 500;
  }

  let correctText = "";

  if (correctGuessers.length > 0) {
    correctGuessers.forEach((playerId) => {
      correctText += "- " + getPlayerName(room, playerId) + "\n";
    });
  } else {
    correctText = "Nobody guessed it.\n";
  }

  const resultText =
    "PASSWORD PANIC RESULTS\n\n" +
    "Clue Giver:\n" +
    (clueGiver ? clueGiver.name : "Unknown Player") +
    "\n\n" +
    "Secret Word:\n" +
    secretWord +
    "\n\n" +
    "Clue:\n" +
    (room.currentPasswordPanicClue || "No clue") +
    "\n\n" +
    "Correct Guessers:\n" +
    correctText +
    "\nAll Guesses:\n" +
    allGuessesText;

  sendToUnity(roomCode, {
    type: "passwordPanicResults",
    clueGiverId: room.passwordPanicClueGiverId,
    clueGiverName: clueGiver ? clueGiver.name : "Unknown Player",
    secretWord,
    clue: room.currentPasswordPanicClue || "No clue",
    resultText,
    players: room.players,
    guesses: room.passwordPanicGuesses,
  });

  io.to(roomCode).emit("game:passwordPanicFinished");

  console.log("Password Panic result:", resultText);
  console.log("Scores:", room.players);
}

function forcePasswordPanicClue(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  if (!room.currentPasswordPanicWord) {
    return;
  }

  if (room.currentPasswordPanicClue) {
    return;
  }

  room.currentPasswordPanicClue = "No clue";

  io.to(roomCode).emit("game:passwordPanicClueGiven", {
    clueGiverId: room.passwordPanicClueGiverId,
    clueGiverName: getPlayerName(room, room.passwordPanicClueGiverId),
    clue: room.currentPasswordPanicClue,
  });

  sendToUnity(roomCode, {
    type: "passwordPanicClueGiven",
    clueGiverId: room.passwordPanicClueGiverId,
    clueGiverName: getPlayerName(room, room.passwordPanicClueGiverId),
    clue: room.currentPasswordPanicClue,
  });

  console.log("Password Panic clue forced:", room.currentPasswordPanicClue);
}

function finishDrawingRound(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  if (room.drawingRoundFinished === true) {
    return;
  }

  room.drawingRoundFinished = true;

  const drawings = [];
  let drawingsText = "";

  room.players.forEach((player) => {
    const drawingDataUrl = room.drawings[player.id];

    if (drawingDataUrl) {
      drawings.push({
        playerId: player.id,
        playerName: player.name,
        drawingDataUrl: drawingDataUrl,
      });

      drawingsText += "- " + player.name + ": Drawing submitted\n";
    } else {
      drawingsText += "- " + player.name + ": No drawing\n";
    }
  });

  const resultText =
    "SKETCH STACK RESULTS\n\n" +
    "Prompt:\n" +
    room.currentDrawingPrompt +
    "\n\n" +
    "Drawings:\n" +
    drawingsText;

  sendToUnity(roomCode, {
    type: "drawingResults",
    prompt: room.currentDrawingPrompt,
    resultText: resultText,
    players: room.players,
    drawings: drawings,
  });

  sendToUnity(roomCode, {
    type: "sketchStackResults",
    prompt: room.currentDrawingPrompt,
    resultText: resultText,
    players: room.players,
    drawings: drawings,
  });

  io.to(roomCode).emit("game:drawingFinished");
  io.to(roomCode).emit("game:sketchStackFinished");

  console.log("Sketch Stack finished:", resultText);
}

wss.on("connection", (ws) => {
  console.log("Unity host connected.");

  ws.on("message", (data) => {
    let message;

    try {
      message = JSON.parse(data.toString());
    } catch {
      console.log("Bad Unity message:", data.toString());
      return;
    }

    if (message.type === "createRoom") {
      if (ws.roomCode && rooms[ws.roomCode]) {
        delete rooms[ws.roomCode];
        delete unityHosts[ws.roomCode];
      }

      createRoomForUnity(ws);
    }

    if (message.type === "endGameCreateNewRoom") {
      closeRoomAndCreateNewRoom(
        ws,
        message.roomCode,
        message.message || "The game ended. Please enter the new room code."
      );
    }

    if (message.type === "forceFinishCopycat") {
      const room = rooms[message.roomCode];

      if (!room) return;
      if (!room.currentCopycatPrompt) return;

      finishCopycatRound(message.roomCode);
    }

    if (message.type === "forceFinishHotSeat") {
      const room = rooms[message.roomCode];

      if (!room) return;
      if (!room.currentHotSeatPrompt) return;
      if (room.hotSeatRoundFinished === true) return;

      sendHotSeatChooseWinner(message.roomCode);
    }

    if (message.type === "forceFinishPasswordPanicClue") {
      forcePasswordPanicClue(message.roomCode);
    }

    if (message.type === "forceFinishPasswordPanicGuesses") {
      const room = rooms[message.roomCode];

      if (!room) return;
      if (!room.currentPasswordPanicWord) return;

      finishPasswordPanicRound(message.roomCode);
    }

    if (message.type === "forceFinishDrawing" || message.type === "forceFinishSketchStack") {
      const room = rooms[message.roomCode];

      if (!room) return;
      if (!room.currentDrawingPrompt) return;

      finishDrawingRound(message.roomCode);
    }

    if (message.type === "startQuestion") {
      const room = rooms[message.roomCode];

      if (!room) return;

      if (message.resetScores === true) {
        resetScores(room);
      }

      room.currentQuestion = message.question;
      room.votes = {};

      io.to(message.roomCode).emit("game:questionStarted", {
        question: message.question,
        players: room.players,
      });

      sendToUnity(message.roomCode, {
        type: "questionStarted",
        question: message.question,
      });

      console.log("Question started:", message.question);
    }

    if (message.type === "startCopycat") {
      const room = rooms[message.roomCode];

      if (!room) return;

      if (room.players.length < 2) {
        sendToUnity(message.roomCode, {
          type: "copycatError",
          message: "Need at least 2 players for Copycat.",
        });
        return;
      }

      if (message.resetScores === true) {
        resetScores(room);
      }

      const targetPlayer = room.players[room.copycatTargetIndex % room.players.length];

      room.copycatTargetIndex++;
      room.copycatTargetPlayerId = targetPlayer.id;
      room.currentCopycatPrompt = message.prompt;
      room.copycatAnswers = {};
      room.copycatRoundFinished = false;

      io.to(message.roomCode).emit("game:copycatStarted", {
        prompt: message.prompt,
        players: room.players,
        targetPlayerId: targetPlayer.id,
        targetPlayerName: targetPlayer.name,
      });

      sendToUnity(message.roomCode, {
        type: "copycatStarted",
        prompt: message.prompt,
        targetPlayerId: targetPlayer.id,
        targetPlayerName: targetPlayer.name,
        players: room.players,
      });

      console.log("Copycat started:", message.prompt);
      console.log("Target player:", targetPlayer.name);
    }

    if (message.type === "startHotSeat") {
      const room = rooms[message.roomCode];

      if (!room) return;

      if (room.players.length < 2) {
        sendToUnity(message.roomCode, {
          type: "hotSeatError",
          message: "Need at least 2 players for Hot Seat.",
        });
        return;
      }

      if (message.resetScores === true) {
        resetScores(room);
      }

      const hotSeatPlayer = room.players[room.hotSeatPlayerIndex % room.players.length];

      room.hotSeatPlayerIndex++;
      room.hotSeatPlayerId = hotSeatPlayer.id;
      room.currentHotSeatPrompt = message.prompt;
      room.hotSeatAnswers = {};
      room.hotSeatRoundFinished = false;

      io.to(message.roomCode).emit("game:hotSeatStarted", {
        prompt: message.prompt,
        players: room.players,
        hotSeatPlayerId: hotSeatPlayer.id,
        hotSeatPlayerName: hotSeatPlayer.name,
      });

      sendToUnity(message.roomCode, {
        type: "hotSeatStarted",
        prompt: message.prompt,
        hotSeatPlayerId: hotSeatPlayer.id,
        hotSeatPlayerName: hotSeatPlayer.name,
        players: room.players,
      });

      console.log("Hot Seat started:", message.prompt);
      console.log("Hot Seat player:", hotSeatPlayer.name);
    }

    if (message.type === "startPasswordPanic") {
      const room = rooms[message.roomCode];

      if (!room) return;

      if (room.players.length < 2) {
        sendToUnity(message.roomCode, {
          type: "passwordPanicError",
          message: "Need at least 2 players for Password Panic.",
        });
        return;
      }

      if (message.resetScores === true) {
        resetScores(room);
      }

      const clueGiver = room.players[room.passwordPanicClueGiverIndex % room.players.length];

      room.passwordPanicClueGiverIndex++;
      room.passwordPanicClueGiverId = clueGiver.id;
      room.currentPasswordPanicWord = message.secretWord;
      room.currentPasswordPanicClue = null;
      room.passwordPanicGuesses = {};
      room.passwordPanicRoundFinished = false;

      room.players.forEach((player) => {
        if (player.id === clueGiver.id) {
          io.to(player.id).emit("game:passwordPanicStarted", {
            clueGiverId: clueGiver.id,
            clueGiverName: clueGiver.name,
            secretWord: message.secretWord,
          });
        } else {
          io.to(player.id).emit("game:passwordPanicStarted", {
            clueGiverId: clueGiver.id,
            clueGiverName: clueGiver.name,
          });
        }
      });

      sendToUnity(message.roomCode, {
        type: "passwordPanicStarted",
        clueGiverId: clueGiver.id,
        clueGiverName: clueGiver.name,
        players: room.players,
      });

      console.log("Password Panic started.");
      console.log("Clue giver:", clueGiver.name);
      console.log("Secret word:", message.secretWord);
    }

    if (message.type === "startDrawing" || message.type === "startSketchStack") {
      const room = rooms[message.roomCode];

      if (!room) return;

      if (room.players.length < 1) {
        sendToUnity(message.roomCode, {
          type: "drawingError",
          message: "Need at least 1 player for Sketch Stack.",
        });
        return;
      }

      if (message.resetScores === true) {
        resetScores(room);
      }

      room.currentDrawingPrompt = message.prompt;
      room.drawings = {};
      room.drawingRoundFinished = false;

      io.to(message.roomCode).emit("game:drawingStarted", {
        prompt: message.prompt,
        players: room.players,
      });

      io.to(message.roomCode).emit("game:sketchStackStarted", {
        prompt: message.prompt,
        players: room.players,
      });

      sendToUnity(message.roomCode, {
        type: "drawingStarted",
        prompt: message.prompt,
        players: room.players,
      });

      sendToUnity(message.roomCode, {
        type: "sketchStackStarted",
        prompt: message.prompt,
        players: room.players,
      });

      console.log("Sketch Stack started:", message.prompt);
    }

    if (message.type === "returnToLobby") {
      closeRoomAndCreateNewRoom(
        ws,
        message.roomCode,
        "The host returned to the lobby. Please enter the new room code."
      );
    }

    if (message.type === "restartGame") {
      const room = rooms[message.roomCode];

      if (!room) return;

      room.currentQuestion = null;
      room.votes = {};

      room.currentCopycatPrompt = null;
      room.copycatAnswers = {};
      room.copycatTargetPlayerId = null;
      room.copycatTargetIndex = 0;
      room.copycatRoundFinished = false;

      room.currentHotSeatPrompt = null;
      room.hotSeatAnswers = {};
      room.hotSeatPlayerId = null;
      room.hotSeatPlayerIndex = 0;
      room.hotSeatRoundFinished = false;

      room.currentPasswordPanicWord = null;
      room.currentPasswordPanicClue = null;
      room.passwordPanicGuesses = {};
      room.passwordPanicClueGiverId = null;
      room.passwordPanicClueGiverIndex = 0;
      room.passwordPanicRoundFinished = false;

      room.currentDrawingPrompt = null;
      room.drawings = {};
      room.drawingRoundFinished = false;

      resetScores(room);

      sendToUnity(message.roomCode, {
        type: "gameRestarted",
        players: room.players,
      });

      io.to(message.roomCode).emit("game:restarted");

      console.log("Game restarted in room:", message.roomCode);
    }
  });

  ws.on("close", () => {
    if (ws.roomCode) {
      io.to(ws.roomCode).emit("game:hostDisconnected");

      delete rooms[ws.roomCode];
      delete unityHosts[ws.roomCode];

      console.log("Unity room closed:", ws.roomCode);
    }
  });
});

io.on("connection", (socket) => {
  console.log("Phone connected:", socket.id);

  socket.on("player:joinRoom", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("player:joinFailed", "Room not found.");
      return;
    }

    const alreadyJoined = room.players.find((player) => player.id === socket.id);

    if (alreadyJoined) {
      socket.join(roomCode);

      socket.emit("player:joinSuccess", {
        roomCode,
        player: alreadyJoined,
      });

      sendToUnity(roomCode, {
        type: "playersUpdated",
        players: room.players,
      });

      return;
    }

    const sameNameAlreadyJoined = room.players.find(
      (player) => player.name.toLowerCase() === playerName.toLowerCase()
    );

    if (sameNameAlreadyJoined) {
      socket.emit("player:joinFailed", "That name is already in the room.");
      return;
    }

    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      socket.emit("player:joinFailed", "Room is full. Max 5 players.");
      return;
    }

    const player = {
      id: socket.id,
      name: playerName,
      score: 0,
    };

    room.players.push(player);
    socket.join(roomCode);

    socket.emit("player:joinSuccess", {
      roomCode,
      player,
    });

    sendToUnity(roomCode, {
      type: "playersUpdated",
      players: room.players,
    });

    console.log(playerName + " joined room " + roomCode);
  });

  socket.on("player:submitVote", ({ roomCode, votedPlayerId }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (socket.id === votedPlayerId) {
      socket.emit("player:voteRejected", "You cannot vote for yourself.");
      return;
    }

    room.votes[socket.id] = votedPlayerId;

    const totalVotes = Object.keys(room.votes).length;
    const totalPlayers = room.players.length;

    sendToUnity(roomCode, {
      type: "votesUpdated",
      totalVotes,
      totalPlayers,
    });

    if (totalVotes >= totalPlayers) {
      const results = addScores(room);

      sendToUnity(roomCode, {
        type: "showResults",
        results,
        players: room.players,
      });

      io.to(roomCode).emit("game:votingFinished");

      console.log("Results:", results);
      console.log("Scores:", room.players);
    }
  });

  socket.on("player:submitCopycatAnswer", ({ roomCode, answer }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (!room.currentCopycatPrompt) {
      socket.emit("player:copycatAnswerRejected", "No Copycat round is active.");
      return;
    }

    if (room.copycatRoundFinished === true) {
      socket.emit("player:copycatAnswerRejected", "This round is already finished.");
      return;
    }

    if (!answer || answer.trim() === "") {
      socket.emit("player:copycatAnswerRejected", "Type an answer first.");
      return;
    }

    if (room.copycatAnswers[socket.id]) {
      socket.emit("player:copycatAnswerRejected", "You already submitted an answer.");
      return;
    }

    room.copycatAnswers[socket.id] = answer.trim();

    const totalAnswers = Object.keys(room.copycatAnswers).length;
    const totalPlayers = room.players.length;

    sendToUnity(roomCode, {
      type: "copycatAnswersUpdated",
      totalAnswers,
      totalPlayers,
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
    });

    if (totalAnswers >= totalPlayers) {
      finishCopycatRound(roomCode);
    }
  });

  socket.on("player:submitHotSeatAnswer", ({ roomCode, answer }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (!room.currentHotSeatPrompt) {
      socket.emit("player:hotSeatAnswerRejected", "No Hot Seat round is active.");
      return;
    }

    if (room.hotSeatRoundFinished === true) {
      socket.emit("player:hotSeatAnswerRejected", "This round is already finished.");
      return;
    }

    if (socket.id === room.hotSeatPlayerId) {
      socket.emit("player:hotSeatAnswerRejected", "You are in the Hot Seat. Wait to pick the winner.");
      return;
    }

    if (!answer || answer.trim() === "") {
      socket.emit("player:hotSeatAnswerRejected", "Type an answer first.");
      return;
    }

    if (room.hotSeatAnswers[socket.id]) {
      socket.emit("player:hotSeatAnswerRejected", "You already submitted an answer.");
      return;
    }

    room.hotSeatAnswers[socket.id] = answer.trim();

    const totalAnswers = Object.keys(room.hotSeatAnswers).length;
    const totalPlayersNeeded = room.players.length - 1;

    sendToUnity(roomCode, {
      type: "hotSeatAnswersUpdated",
      totalAnswers,
      totalPlayersNeeded,
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
    });

    if (totalAnswers >= totalPlayersNeeded) {
      sendHotSeatChooseWinner(roomCode);
    }
  });

  socket.on("player:chooseHotSeatWinner", ({ roomCode, winnerPlayerId }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (room.hotSeatRoundFinished === true) {
      socket.emit("player:hotSeatAnswerRejected", "This round is already finished.");
      return;
    }

    if (socket.id !== room.hotSeatPlayerId) {
      socket.emit("player:hotSeatAnswerRejected", "Only the Hot Seat player can pick the winner.");
      return;
    }

    if (!room.hotSeatAnswers[winnerPlayerId]) {
      socket.emit("player:hotSeatAnswerRejected", "That answer was not found.");
      return;
    }

    finishHotSeatRound(roomCode, winnerPlayerId);
  });

  socket.on("player:submitPasswordPanicClue", ({ roomCode, clue }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (!room.currentPasswordPanicWord) {
      socket.emit("player:passwordPanicRejected", "No Password Panic round is active.");
      return;
    }

    if (room.passwordPanicRoundFinished === true) {
      socket.emit("player:passwordPanicRejected", "This round is already finished.");
      return;
    }

    if (socket.id !== room.passwordPanicClueGiverId) {
      socket.emit("player:passwordPanicRejected", "Only the clue giver can submit the clue.");
      return;
    }

    if (!clue || clue.trim() === "") {
      socket.emit("player:passwordPanicRejected", "Type a clue first.");
      return;
    }

    if (room.currentPasswordPanicClue) {
      socket.emit("player:passwordPanicRejected", "You already submitted a clue.");
      return;
    }

    room.currentPasswordPanicClue = clue.trim();

    io.to(roomCode).emit("game:passwordPanicClueGiven", {
      clueGiverId: room.passwordPanicClueGiverId,
      clueGiverName: getPlayerName(room, room.passwordPanicClueGiverId),
      clue: room.currentPasswordPanicClue,
    });

    sendToUnity(roomCode, {
      type: "passwordPanicClueGiven",
      clueGiverId: room.passwordPanicClueGiverId,
      clueGiverName: getPlayerName(room, room.passwordPanicClueGiverId),
      clue: room.currentPasswordPanicClue,
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
    });

    console.log("Password Panic clue:", room.currentPasswordPanicClue);
  });

  socket.on("player:submitPasswordPanicGuess", ({ roomCode, guess }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (!room.currentPasswordPanicWord || !room.currentPasswordPanicClue) {
      socket.emit("player:passwordPanicRejected", "No Password Panic guess phase is active.");
      return;
    }

    if (room.passwordPanicRoundFinished === true) {
      socket.emit("player:passwordPanicRejected", "This round is already finished.");
      return;
    }

    if (socket.id === room.passwordPanicClueGiverId) {
      socket.emit("player:passwordPanicRejected", "The clue giver cannot guess.");
      return;
    }

    if (!guess || guess.trim() === "") {
      socket.emit("player:passwordPanicRejected", "Type a guess first.");
      return;
    }

    if (room.passwordPanicGuesses[socket.id]) {
      socket.emit("player:passwordPanicRejected", "You already guessed.");
      return;
    }

    room.passwordPanicGuesses[socket.id] = guess.trim();

    const totalGuesses = Object.keys(room.passwordPanicGuesses).length;
    const totalPlayersNeeded = room.players.length - 1;

    sendToUnity(roomCode, {
      type: "passwordPanicGuessesUpdated",
      totalGuesses,
      totalPlayersNeeded,
      playerId: socket.id,
      playerName: getPlayerName(room, socket.id),
    });

    if (totalGuesses >= totalPlayersNeeded) {
      finishPasswordPanicRound(roomCode);
    }
  });

  socket.on("player:submitDrawing", ({ roomCode, drawingDataUrl }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (!room.currentDrawingPrompt) {
      socket.emit("player:drawingRejected", "No Sketch Stack round is active.");
      return;
    }

    if (room.drawingRoundFinished === true) {
      socket.emit("player:drawingRejected", "This drawing round is already finished.");
      return;
    }

    const player = getPlayer(room, socket.id);

    if (!player) {
      socket.emit("player:drawingRejected", "You are not in this room.");
      return;
    }

    if (room.drawings[socket.id]) {
      socket.emit("player:drawingRejected", "You already submitted a drawing.");
      return;
    }

    if (!drawingDataUrl || typeof drawingDataUrl !== "string") {
      socket.emit("player:drawingRejected", "Drawing was not sent correctly.");
      return;
    }

    if (!drawingDataUrl.startsWith("data:image/png;base64,")) {
      socket.emit("player:drawingRejected", "Drawing must be a PNG image.");
      return;
    }

    if (drawingDataUrl.length > MAX_DRAWING_DATA_LENGTH) {
      socket.emit("player:drawingRejected", "Drawing is too large. Try clearing and drawing again.");
      return;
    }

    room.drawings[socket.id] = drawingDataUrl;

    const totalDrawings = Object.keys(room.drawings).length;
    const totalPlayers = room.players.length;

    sendToUnity(roomCode, {
      type: "drawingSubmitted",
      totalDrawings,
      totalPlayers,
      playerId: socket.id,
      playerName: player.name,
    });

    sendToUnity(roomCode, {
      type: "sketchStackDrawingSubmitted",
      totalDrawings,
      totalPlayers,
      playerId: socket.id,
      playerName: player.name,
    });

    console.log(player.name + " submitted a drawing.");

    if (totalDrawings >= totalPlayers) {
      finishDrawingRound(roomCode);
    }
  });

  socket.on("disconnect", () => {
    console.log("Phone disconnected:", socket.id);

    for (const roomCode in rooms) {
      const room = rooms[roomCode];

      const oldLength = room.players.length;
      room.players = room.players.filter((player) => player.id !== socket.id);

      if (room.votes) {
        delete room.votes[socket.id];
      }

      if (room.copycatAnswers) {
        delete room.copycatAnswers[socket.id];
      }

      if (room.hotSeatAnswers) {
        delete room.hotSeatAnswers[socket.id];
      }

      if (room.passwordPanicGuesses) {
        delete room.passwordPanicGuesses[socket.id];
      }

      if (room.drawings) {
        delete room.drawings[socket.id];
      }

      if (room.players.length !== oldLength) {
        sendToUnity(roomCode, {
          type: "playersUpdated",
          players: room.players,
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Spillstack server running on port " + PORT);
});
