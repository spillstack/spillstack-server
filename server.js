socket.on("bowlingNextTurn", (data) => {
    const roomCode = String(data.roomCode || "")
        .trim()
        .toUpperCase();

    const keepSamePlayer =
        data.keepSamePlayer === true;

    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    if (
        !room.bowling ||
        !room.bowling.active
    ) {
        return;
    }

    if (
        !room.players ||
        room.players.length === 0
    ) {
        return;
    }

    // ==========================================
    // SAME PLAYER GETS BALL 2 / BONUS BALL
    // ==========================================
    if (keepSamePlayer) {
        const currentIndex =
            Math.max(
                0,
                Math.min(
                    room.bowling.turnIndex || 0,
                    room.players.length - 1
                )
            );

        const currentPlayer =
            room.players[currentIndex];

        if (!currentPlayer) {
            return;
        }

        io.to(roomCode).emit(
            "bowlingTurn",
            {
                currentPlayerId:
                    currentPlayer.id,

                currentPlayerName:
                    currentPlayer.name,

                turnIndex:
                    currentIndex,

                totalPlayers:
                    room.players.length,

                samePlayer:
                    true
            }
        );

        return;
    }

    // ==========================================
    // FRAME FINISHED - NEXT PLAYER
    // ==========================================

    room.bowling.turnIndex++;

    if (
        room.bowling.turnIndex >=
        room.players.length
    ) {
        room.bowling.turnIndex = 0;
    }

    const nextPlayer =
        room.players[
            room.bowling.turnIndex
        ];

    if (!nextPlayer) {
        return;
    }

    io.to(roomCode).emit(
        "bowlingTurn",
        {
            currentPlayerId:
                nextPlayer.id,

            currentPlayerName:
                nextPlayer.name,

            turnIndex:
                room.bowling.turnIndex,

            totalPlayers:
                room.players.length,

            samePlayer:
                false
        }
    );
});
