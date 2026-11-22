# SIDcog Demo

This static application ports the Parallax Propeller P1 SIDcog v1.4 synthesizer, the January 2021 revision by Johannes Ahlebrand and Ada Gottensträter. Use an HTTPS static host or run `python3 -m http.server 8000 --directory docs` from the project root and open `http://localhost:8000/`. The opening selection is the supplied **013.dmp**. Select **Start audio** to play its first music block. The chapter menu also provides the waveform introduction and SIDcog features sequence. There are no build dependencies. Run the offline verification with `npm test` using Node.js 20 or newer.

## Source and assets

The [Parallax repository commit](https://github.com/parallaxinc/propeller/commit/dc21f6a11fe5a16dc8cc8c9751b622f48a68ce05) is `dc21f6a11fe5a16dc8cc8c9751b622f48a68ce05`. Paths below are relative to [`libraries/community/p1/All/SIDcog v1.3/`](https://github.com/parallaxinc/propeller/tree/dc21f6a11fe5a16dc8cc8c9751b622f48a68ce05/libraries/community/p1/All/SIDcog%20v1.3).

| File | Use |
| --- | --- |
| `SIDcog_V1.4/SIDcog.spin` | UTF-16LE reference, decoded using its byte-order mark. Source of the oscillator, envelope, noise, filter, and mixer routines. |
| `SIDcog_V1.4/CombinedWaveforms.bin` | Exact 1,024-byte waveform table, bundled in this application. |
| `ExamplePlayRoutine/ExamplePlayroutine.spin` and `ReadMe.txt` | Reference for the 21 Hz note sequencer and playback API. |
| `ExampleSidDumpPlay/ExampleSidDumpPlay.spin` and `ReadMe.txt` | Reference for 25-byte frame layout and nominal 50 Hz scheduling. The example's `Lost_Friend.dmp` is identified by the source and readme. The site uses the exact dump from the Parallax OBEX ZIP, described below. |
| `README.md` and repository root `LICENSE.txt` | Upstream feature notes and repository licensing. |

SHA-256 of `SIDcog.spin` (original UTF-16LE bytes) is `f5e08d84a6753742eea1a73788b1704e42c0c631c5859aa17bc143a387d20155`. SHA-256 of `CombinedWaveforms.bin` is `9187013f04ba01d61af743460cc55feeacc8f5661c4d4245897ae6200b3bf3e2`. The full upstream notices are in [NOTICE.txt](NOTICE.txt).

The black introduction, blue display, 450 × 360 composition, lettering, scrollers and technical cues were reconstructed from the supplied scene descriptions. The original visual program and playable recording or frame files could not be inspected. The reference timestamps mark example scenes, so this shorter reconstruction uses newly authored cue and transition times. The [original discussion](https://forums.parallax.com/discussion/118285/sidcog-the-sound-of-the-commodore-64) provides historical context. The Canvas glyphs and animated background are original. The [HydraCD mirror](https://github.com/Wuerfel21/HydraCD) supplied context and has a separate restricted disc license. No files from it are bundled.

The pixel-art observatory was generated with GPT Image for the browser interface. The player bundles it as a local WebP. The reconstructed demonstration runs separately in its original 450 × 360 composition.

## Live register display

At approximately 30 updates per second, the AudioWorklet sends a bounded snapshot with current registers, the zero-based frame number and the high byte of each voice’s amplitude envelope. Between packets it accumulates bit transitions for all 25 addresses, so a bit that toggles twice still appears in the activity display. The three channel strips show frequency and waveform controls, gate, seven hexadecimal bytes with their individual bits, and the envelope history. The four-second raster uses one lane per address, grouped by voice and global registers. Cutoff displays the 11-bit register setting. On narrow screens, three envelope meters also sit directly below the waveform. Pausing freezes the plots after the short transport ramp, and restarting clears them.

## Audio and local files

The 80 MHz P1 clock and 985,248 Hz PAL SID clock give `floor(80000000 / floor(985248 / 32)) = 2598` P1 ticks per sample, or approximately 30,792.918 Hz. One AudioWorklet applies scheduled full register images to the fixed-point synthesis core on that cadence. Linear interpolation with a persistent fractional phase converts the source rate to the AudioContext rate. The browser removes the duty-DAC midpoint, DC-blocks residual offset at 12 Hz, and applies fixed headroom and a separate output gain. The scope displays mono PCM from the worklet before the user mute and volume controls.

Raw dumps contain consecutive 25-byte SID register images with no header. The register order is voice 1 at `$00–$06`, voice 2 at `$07–$0D`, voice 3 at `$0E–$14`, and filter/volume at `$15–$18`. At the default 50 Hz, divide the image count by 50 for the duration. The frame rate can be set from 1 to 300 Hz. The importer rejects empty or partial images and C64 PSID/RSID files. Imported bytes stay in the page and its local audio processor.

### Bundled music

`013.dmp` is the unchanged 5,742,300-byte register stream supplied in `013.zip`. The [Parallax Retromachine thread](https://forums.parallax.com/discussion/157850/a-de2-115-propeller-retromachine-1920x1080-enabled) identifies the attachment as Ahle's SIDcog demo dump and describes 50, 100, 150 and 200 Hz playback. The file has 229,692 frames, begins with silence, and contains beeps at frames 759 and 1,100. The first music block begins at frame 2,200 with all three oscillators held in test/reset. The chapter starts there and runs for 1:15:49.84 at 50 Hz. Select **Include the recorded prelude** to play from frame zero. The other frame rates are user-selectable because the dump contains no timing metadata. The project's visual chapter timing remains a reconstruction. SHA-256 of the full file is `4cdfb06b1f3cc8c3d97cc5c0c438135a60cd52b416c56632633e964662f735b8`.

The [SIDcog v1.3 Parallax OBEX package](https://obex.parallax.com/obex/sidcog-v1-3/) (object 2473) contains one raw dump, `ExampleSidDumpPlay/Lost_Friend.dmp`. It is bundled byte-for-byte for this demo. Select **Lost Friend** in the track menu to play it at the Spin example’s 50 Hz rate. The source contains 17,950 frames (5:59). Playback stops after frame 6,849 (2:17), after the measured release tail and before the remaining silence. Its SHA-256 is `e7aed5629b8b3bdc5ca0c25b380d9b81e033215f185b0d73671c40d54ff55df2`. The same ZIP also includes a rendered MP3 medley. The C64 release [Lost Friend](https://csdb.dk/release/?id=63827) credits Factor6. The upstream software notice is preserved separately in [NOTICE.txt](NOTICE.txt).

Restart and chapter changes clear the voice, filter, noise, envelope, resampler and sequence states. Manual mode makes the controller's register image authoritative until the user switches back to Demo.

The source applies ring indexing to all combined waveforms. It takes the effective filter cutoff's low three bits from routing, uses a 2-bit shift in the third voice's combined branch, skips to the third envelope on a voice 1 noise combination, and ignores the voice-3-off bit. The port preserves those behaviors, with no emulation of the original SID's ADSR bug. It models the digital output and does not simulate the analog output circuit or execute Propeller binaries. See the [Web Audio specification](https://www.w3.org/TR/webaudio-1.0/) for the host API.

## Verification

Offline checks pin the waveform data hash and cover the register layout, independently calculated phase-wrap pitch and pulse duty, gate and release, test/reset, cyclic sync, combined tables and ring indexing, noise, cutoff and resonance extremes, all filter-mode combinations, and SID volume zero. They confirm identical PCM after restart, full chapter progression, finite unclipped PCM, and matching pitch within 0.02 Hz between 44.1 and 48 kHz with frame timing within 90 μs of expectation. The worklet adapter check compares a published waveform buffer to its output PCM and tests freeze/resume at different block sizes. The bundled music test verifies the archive hash, two-beep prelude, first music register image and rate settings. A graph lifecycle check verifies that repeated Start uses one context, worklet and gain node.

The full music section rendered offline at 48 kHz at all four selectable register rates. Every sample was finite and peak PCM magnitude stayed at or below 0.620. Chromium preview checks confirmed live dump registers and waveform, the alternate rate selector, and the prelude setting. Prior browser checks covered audio startup at 44.1 kHz, the changing Canvas waveform, pause/resume, chapter restart, manual register updates, CRT, fullscreen and its exit, and valid and malformed local imports including a frame rate change. The current Chromium preview opened on `013.dmp`, advanced from the first music block, showed changing register bytes and envelope values, and froze the frame counter on pause. Switching the manual gate off cleared the corresponding control bit in the channel strip. A 390-pixel preview confirmed that the three compact envelope meters update under the waveform and the page has no horizontal overflow. Offline packet checks also compare displayed envelope bytes and frame positions to DSP state and verify that a pair of short register toggles survives until the next display snapshot.

Physical audio output, mobile Safari and native SIDcog output traces were unavailable for comparison.

### SIDcog P2 dump collection

The supplied `SIDcogP2_v1_3_experimental.zip` contains 90 `.dmp` files and one `.dmp.bak` backup. All 91 are selectable. Lost Friend shares the existing entry because its bytes match the bundled OBEX copy. The other 90 entries are under **SIDcog P2 collection**. Identical files share storage and retain their individual menu entries. The archive player specifies 50 Hz. The browser downloads the compressed collection upon first use and decompresses the selected dump without changing its bytes.
