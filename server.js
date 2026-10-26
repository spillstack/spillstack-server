if (message.type === "bowlingNextTurn") {
  const room = rooms[message.roomCode];
  if (!room || !room.bowlingActive) return;
  if (!room.bowlingThrown) return;

  const keepSamePlayer =
    message.keepSamePlayer === true;

  if (!keepSamePlayer) {
    room.bowlingTurnIndex++;

    if (
      room.bowlingTurnIndex >=
      room.players.length
    ) {
      room.bowlingTurnIndex = 0;
    }
  }

  sendBowlingTurn(message.roomCode);
}
