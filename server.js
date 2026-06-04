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

function makeRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
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
  const targetAnswer = room.copycatAnswers[room.copycatTargetPlayerId] || "";
  const cleanTargetAnswer = cleanAnswer(targetAnswer);

  let correctGuessers = [];
  let allGuessesText = "";

  for (const playerId in room.copycatAnswers) {
    if (playerId === room.copycatTargetPlayerId) {
      continue;
    }

    const guess = room.copycatAnswers[playerId];
    const playerName = getPlayerName(room, playerId);
    const isCorrect = cleanAnswer(guess) === cleanTargetAnswer;

    if (isCorrect) {
      correctGuessers.push(playerId);
      allGuessesText += "- " + playerName + ": " + guess + " CORRECT\n";
    } else {
      allGuessesText += "- " + playerName + ": " + guess + "\n";
    }
  }

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

  const resultData = makeCopycatResultText(room);

  sendToUnity(roomCode, {
    type: "copycatResults",
    prompt: room.currentCopycatPrompt,
    targetPlayerId: room.copycatTargetPlayerId,
    targetPlayerName: resultData.targetName,
    targetAnswer: resultData.targetAnswer,
    resultText: resultData.resultText,
    players: room.players,
  });

  io.to(roomCode).emit("game:copycatFinished");

  console.log("Copycat result:", resultData.resultText);
  console.log("Scores:", room.players);
}

function finishHotSeatRound(roomCode, winnerPlayerId) {
  const room = rooms[roomCode];

  if (!room) return;

  const winner = getPlayer(room, winnerPlayerId);
  const hotSeatPlayer = getPlayer(room, room.hotSeatPlayerId);

  if (!winner) return;

  winner.score += 1000;

  const winningAnswer = room.hotSeatAnswers[winnerPlayerId] || "";

  let answersText = "";

  for (const playerId in room.hotSeatAnswers) {
    const playerName = getPlayerName(room, playerId);
    const answer = room.hotSeatAnswers[playerId];

    if (playerId === winnerPlayerId) {
      answersText += "- " + playerName + ": " + answer + " WINNER\n";
    } else {
      answersText += "- " + playerName + ": " + answer + "\n";
    }
  }

  const resultText =
    "HOT SEAT RESULTS\n\n" +
    "Hot Seat Player:\n" +
    (hotSeatPlayer ? hotSeatPlayer.name : "Unknown Player") +
    "\n\n" +
    "Winning Answer:\n" +
    winningAnswer +
    "\n\n" +
    "Winner:\n" +
    winner.name +
    "\n\n" +
    "All Answers:\n" +
    answersText;

  sendToUnity(roomCode, {
    type: "hotSeatResults",
    prompt: room.currentHotSeatPrompt,
    hotSeatPlayerId: room.hotSeatPlayerId,
    hotSeatPlayerName: hotSeatPlayer ? hotSeatPlayer.name : "Unknown Player",
    winnerPlayerId,
    winnerPlayerName: winner.name,
    winningAnswer,
    resultText,
    players: room.players,
  });

  io.to(roomCode).emit("game:hotSeatFinished");

  console.log("Hot Seat result:", resultText);
  console.log("Scores:", room.players);
}

function finishPasswordPanicRound(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  const secretWord = room.currentPasswordPanicWord || "";
  const cleanSecret = cleanAnswer(secretWord);
  const clueGiver = getPlayer(room, room.passwordPanicClueGiverId);

  let correctGuessers = [];
  let allGuessesText = "";

  for (const playerId in room.passwordPanicGuesses) {
    const guess = room.passwordPanicGuesses[playerId];
    const playerName = getPlayerName(room, playerId);
    const isCorrect = cleanAnswer(guess) === cleanSecret;

    if (isCorrect) {
      correctGuessers.push(playerId);
      allGuessesText += "- " + playerName + ": " + guess + " CORRECT\n";
    } else {
      allGuessesText += "- " + playerName + ": " + guess + "\n";
    }
  }

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
    room.currentPasswordPanicClue +
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
    clue: room.currentPasswordPanicClue,
    resultText,
    players: room.players,
  });

  io.to(roomCode).emit("game:passwordPanicFinished");

  console.log("Password Panic result:", resultText);
  console.log("Scores:", room.players);
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
      const roomCode = makeRoomCode();

      rooms[roomCode] = {
        players: [],
        currentQuestion: null,
        votes: {},

        currentCopycatPrompt: null,
        copycatAnswers: {},
        copycatTargetPlayerId: null,
        copycatTargetIndex: 0,

        currentHotSeatPrompt: null,
        hotSeatAnswers: {},
        hotSeatPlayerId: null,
        hotSeatPlayerIndex: 0,

        currentPasswordPanicWord: null,
        currentPasswordPanicClue: null,
        passwordPanicGuesses: {},
        passwordPanicClueGiverId: null,
        passwordPanicClueGiverIndex: 0,
      };

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

    if (message.type === "returnToLobby") {
      const room = rooms[message.roomCode];

      if (!room) return;

      room.currentQuestion = null;
      room.votes = {};

      room.currentCopycatPrompt = null;
      room.copycatAnswers = {};
      room.copycatTargetPlayerId = null;

      room.currentHotSeatPrompt = null;
      room.hotSeatAnswers = {};
      room.hotSeatPlayerId = null;

      room.currentPasswordPanicWord = null;
      room.currentPasswordPanicClue = null;
      room.passwordPanicGuesses = {};
      room.passwordPanicClueGiverId = null;

      io.to(message.roomCode).emit("game:returnToLobby");

      sendToUnity(message.roomCode, {
        type: "returnedToLobby",
        players: room.players,
      });

      console.log("Returned phones to lobby for room:", message.roomCode);
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

      room.currentHotSeatPrompt = null;
      room.hotSeatAnswers = {};
      room.hotSeatPlayerId = null;
      room.hotSeatPlayerIndex = 0;

      room.currentPasswordPanicWord = null;
      room.currentPasswordPanicClue = null;
      room.passwordPanicGuesses = {};
      room.passwordPanicClueGiverId = null;
      room.passwordPanicClueGiverIndex = 0;

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
    });

    if (totalAnswers >= totalPlayersNeeded) {
      const answers = [];

      for (const playerId in room.hotSeatAnswers) {
        answers.push({
          playerId,
          answer: room.hotSeatAnswers[playerId],
        });
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
        totalAnswers,
      });
    }
  });

  socket.on("player:chooseHotSeatWinner", ({ roomCode, winnerPlayerId }) => {
    const room = rooms[roomCode];

    if (!room) return;

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

    if (socket.id !== room.passwordPanicClueGiverId) {
      socket.emit("player:passwordPanicRejected", "Only the clue giver can submit the clue.");
      return;
    }

    if (!clue || clue.trim() === "") {
      socket.emit("player:passwordPanicRejected", "Type a clue first.");
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
    });

    if (totalGuesses >= totalPlayersNeeded) {
      finishPasswordPanicRound(roomCode);
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