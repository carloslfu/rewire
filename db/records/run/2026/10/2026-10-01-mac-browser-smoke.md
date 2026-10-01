---
type: run
id: 01m3wk95c9zrdrz1rqm9y088rs
created: 2026-10-01T20:42:48.073423+00:00
updated: 2026-10-01T20:42:48.073423+00:00
summary: Safari live contrast and Firefox default replay smoke observations
captured_at: 2026-10-01T20:42:48.068115+00:00
command: Open the CSP production preview in Safari and Firefox; inspect startup state; apply the Paris/Rome swap in Safari
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Safari live contrast and Firefox default replay smoke observations
tool: cua_repl native accessibility
---
Safari, filtered native accessibility excerpt:

```text
HTML content Description: Rewire, URL: localhost:5199/#step-1
					5 link Skip to the conversation, Value: localhost:5199/#conversation
					6 container
						7 text Rewire Qwen3-0.6B, a small open chat AI that runs on your device. Tap any part to see or change it. Live
						8 button How it works
					9 container
						10 container Conversation
							11 container Swap Paris and Rome
								12 text STEP 1 OF 11
								13 heading Swap Paris and Rome, Value: 2
									14 text Swap Paris and Rome
								15 text The model stores every word as a row of numbers in its dictionary. What if Paris and Rome traded rows?
								16 toggle button (disabled) Undo: Swap Paris and Rome, Value: on
								17 link Next, Value: localhost:5199/#step-2
							18 container Changes
								19 text Paris and Rome swapped
								20 button Remove: Paris and Rome swapped
								21 button Reset all
							22 container
								23 text You : What is Rome's most famous landmark?
							24 text Normal
							25 container Normal: Rome's most famous landmark is the Colosseum.
								26 toggle button R: the changed model gives it <1%, Help: Normal 92%, changed <1%, Value: off
								27 toggle button ome: the changed model gives it 9%, Help: Normal >99%, changed 9%, Value: off
								28 toggle button 's, Value: off
								29 toggle button most, Value: off
								30 toggle button famous, Value: off
								31 toggle button landmark, Value: off
								32 toggle button is, Value: off
								33 toggle button the, Value: off
								34 toggle button Col, Value: off
								35 toggle button os, Value: off
								36 toggle button se, Value: off
								37 toggle button um, Value: off
								38 toggle button ., Value: off
							39 text Underlined: words the changed model finds unlikely.
							40 text Changed: Paris and Rome swapped
							41 container Changed: Paris and Rome swapped: Paris's most famous landmark is the Eiffel Tower
								42 toggle button Paris, Value: off
								43 toggle button 's, Value: off
								44 toggle button most, Value: off
								45 toggle button famous, Value: off
								46 toggle button landmark, Value: off
								47 toggle button is, Value: off
								48 toggle button the, Value: off
								49 toggle button E, Value: off
								50 toggle button iff, Value: off
								51 toggle button el, Value: off
								52 toggle button Tower, Value: on
							53 button (collapsed) What the model actually reads, Secondary Actions: Expand
							54 container
								55 text field (disabled, settable) Message, Placeholder: Ask it about Paris or Rome
								56 button (disabled) Send
							57 button (collapsed) What's real here, Secondary Actions: Expand
						58 
```

Firefox, filtered native accessibility excerpt:

```text
HTML Content Description: Rewire, URL: localhost:5199/#step-1
				34 container
					35 link Skip to the conversation, Value: localhost:5199/#conversation
					36 text Rewire
					37 text Qwen3-0.6B, a small open chat AI that runs on your device. Tap any part to see or change it.
					38 container These are recordings of real runs on this model.
						39 text Replay
					40 button How it works
					41 text This device is too slow to run it live, so these are recordings of real runs.
					42 button Run it live anyway
					43 text Rome's most famous landmark is the Colosseum.
					44 container Conversation
						45 container Swap Paris and Rome
							46 text STEP 1 OF 11
							47 heading Swap Paris and Rome, Value: 2
								48 text Swap Paris and Rome
							49 text The model stores every word as a row of numbers in its dictionary. What if Paris and Rome traded rows?
							50 toggle button Swap Paris and Rome, Value: off
							51 link Next, Value: localhost:5199/#step-2
						52 container
							53 container
								54 text You : 
							55 text What is Rome's most famous landmark?
							56 container Reply: Rome's most famous landmark is the Colosseum.
								57 toggle button R, Value: off
								58 toggle button ome, Value: off
								59 toggle button 's, Value: off
								60 toggle button most, Value: off
								61 toggle button famous, Value: off
								62 toggle button landmark, Value: off
								63 toggle button is, Value: off
								64 toggle button the, Value: off
								65 toggle button Col, Value: on
								66 toggle button os, Value: off
								67 toggle button se, Value: off
								68 toggle button um, Value: off
								69 toggle button ., Value: off
							70 button What the model actually reads
						71 button What's real here
					72 container The tower
						73 heading Pushes toward "Col", Value: 2
							74 text Pushes toward "Col"
				
```
