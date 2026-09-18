# Multiplayer test log

Two independent headless clients against the authoritative server, one on a
clean link and one under simulated impairment.

```
$ npm run server
Luna Prix server listening on ws://localhost:8787
rules lp-1.0.0

$ node tools/netclient.mjs ws://localhost:8787 Ada canopy mock-buba   kart-moonshard  0   0
$ node tools/netclient.mjs ws://localhost:8787 Bo  canopy mock-puffy  kart-dartwing   80  0.03
```

`Bo` runs with 80 ms one-way latency and 3% packet loss applied to every frame
in both directions.

## Result

```
server  room rhkes1c: start seed=2333398686 players=2 bots=6
server  room rhkes1c: complete, publishable=true

[Ada] lobby rhkes1c: 2 in, start in 12s (me=yes)
[Ada] START seed=2333398686 field=8
[Ada] RESULT accepted=true finish=1/8 time=90.89s bestLap=44.23s publishable=true snapshots=2174 rate=18.9/s

[Bo]  lobby rhkes1c: 2 in, start in 12s (me=yes)
[Bo]  START seed=2333398686 field=8
[Bo]  RESULT accepted=true finish=5/8 time=102.44s bestLap=44.03s publishable=true snapshots=2174 rate=18.9/s
```

## What this shows

| | |
|---|---|
| Both clients joined the **same room** and received the **same seed** | Lobby, matchmaking and race agreement work |
| Field of 8 = 2 players + 6 bots | A partly-filled room is still a full race |
| Snapshot rate 18.9/s against a 20/s target | The server held its budget for the whole race |
| Both results `accepted=true`, `publishable=true` | The server ran the race, validated it, and published its own result |
| `Bo` best lap 44.03 s vs `Ada` 44.23 s | 80 ms and 3% loss cost track position, not competence — prediction and correction held |

The server rejects client-submitted results outright; the result each client
received is the one the server's own simulation produced.
