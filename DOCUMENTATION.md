# IR shooting training PoC — Technical Documentation

## Overview

IR shooting training PoC is a camera-based IR target shooting training system built with Electron and React. A projector displays digital targets on a wall. The shooter fires an IR gun at the projected target. A camera watches the wall, detects the IR hit, and maps it back to screen coordinates using a homography transform. The app scores the shot, displays feedback on both the control screen and the projector, and records session data to a local SQLite database.

There are no physical targets. Everything is digitally projected and scored.

---

## System Architecture

```
┌─────────────────┐     IPC      ┌──────────────────┐
│  Control Window  │◄────────────►│  Projector Window │
│  (your monitor)  │             │  (wall/projector)  │
│                  │             │                    │
│  - HUD overlay   │             │  - Target rings    │
│  - Camera feed   │             │  - Hit markers     │
│  - Shot log      │             │  - Calibration     │
│  - Settings      │             │    markers         │
└────────┬─────────┘             └──────────────────┘
         │
         │ WebRTC
         ▼
┌─────────────────┐
│     Camera       │
│  (watches wall)  │
└─────────────────┘
```

**Data flow for a shot:**

1. Camera captures video frames via WebRTC
2. `IRDetector` processes each frame, finds the brightest IR point
3. If a shot is detected (brightness spike or dwell), the raw camera coordinates are captured
4. `CalibrationEngine` transforms camera coordinates → projector screen coordinates via a 3x3 homography matrix
5. `ScoringEngine` calculates the score based on distance from target center
6. The shot is displayed on the control window's `TargetCanvas`
7. The shot is sent via IPC to the `ProjectorView` to show on the wall
8. The shot is persisted to SQLite via IPC to the main process

---

## Project Structure

```
IR shooting training PoC-electron/
├── electron/                    # Electron main process (Node.js)
│   ├── main.ts                  # App window management, IPC handlers, display enumeration
│   ├── preload.ts               # Context bridge exposing IPC to renderer
│   └── database.ts              # SQLite database operations (better-sqlite3)
│
├── src/                         # React renderer process
│   ├── main.tsx                 # React entry point
│   ├── App.tsx                  # Root component, screen router, projector detection
│   │
│   ├── screens/                 # Full-page screen components
│   │   ├── MainMenu.tsx         # Cinematic main menu with particle background
│   │   ├── ShootingScreen.tsx   # Live shooting HUD — the main gameplay screen
│   │   ├── CalibrationScreen.tsx# Step-by-step calibration wizard
│   │   ├── ProjectorView.tsx    # Full-screen canvas rendered on the projector
│   │   ├── ResultsScreen.tsx    # Post-session debrief with stats
│   │   └── SettingsScreen.tsx   # Camera, projection, detection, target config
│   │
│   ├── components/
│   │   ├── shooting/
│   │   │   ├── TargetCanvas.tsx # Canvas2D renderer for target, traces, shots
│   │   │   ├── HUDOverlay.tsx   # Tactical HUD with score, timer, shot log, controls
│   │   │   ├── ShotFeedback.tsx # Animated score popup and hit ring on shot
│   │   │   └── CameraPreview.tsx# Draggable live camera feed with IR overlay
│   │   ├── effects/
│   │   │   └── ParticleField.tsx# Three.js floating particle background
│   │   └── ui/
│   │       └── TitleBar.tsx     # Custom frameless window title bar
│   │
│   ├── engine/                  # Core processing logic (no UI dependencies)
│   │   ├── IRDetector.ts        # IR spot detection and shot event detection
│   │   ├── CalibrationEngine.ts # Homography computation and coordinate transform
│   │   └── ScoringEngine.ts     # Score calculation from screen position
│   │
│   ├── hooks/                   # React hooks
│   │   ├── useCamera.ts         # WebRTC camera management
│   │   └── useDetectionLoop.ts  # requestAnimationFrame loop for IR detection
│   │
│   ├── store/
│   │   └── useAppStore.ts       # Zustand global state store
│   │
│   ├── data/
│   │   └── targets.ts           # Built-in target library (9 targets)
│   │
│   ├── types/
│   │   └── index.ts             # All TypeScript interfaces and type definitions
│   │
│   └── styles/
│       └── index.css            # Tailwind base + tactical game theme + HUD styles
│
├── package.json
├── vite.config.ts               # Vite + electron plugin config
├── tailwind.config.js           # Tailwind theme with tactical colors and animations
├── tsconfig.json                # TypeScript config for renderer
└── tsconfig.node.json           # TypeScript config for electron/vite
```

---

## Core Engines

### IRDetector (`src/engine/IRDetector.ts`)

Processes camera frames to find the brightest IR point and detect shot events.

**How it works:**
- Draws each video frame to an `OffscreenCanvas`
- Scans pixel data to find the brightest point (weighted grayscale: 50% red, 30% green, 20% blue — IR shows strongest in the red channel)
- Uses a two-pass approach: coarse scan (every 2nd pixel) then fine refinement around the brightest area
- Maintains a rolling brightness history (30 frames) to compute a baseline

**Detection modes:**

| Mode | How it triggers a shot |
|------|----------------------|
| `flash` | Brightness spikes above `brightnessThreshold` AND above `baseline × flashSpikeMultiplier` AND above `baseline + 50`. This catches the brief IR pulse from the gun. |
| `dwell` | IR point stays within `dwellRadius` pixels for `dwellTime` milliseconds. For guns that hold a steady beam. |
| `hybrid` | Tries flash first, falls back to dwell. |

**Key config values:**
- `brightnessThreshold` (0–255): Absolute minimum brightness to consider a shot
- `flashSpikeMultiplier` (1.5–5): How many times brighter than baseline to trigger
- `minBrightness` (10–150): Below this, the IR point isn't tracked at all
- `blurRadius`: Gaussian blur kernel size (not applied in JS version, reserved for future OpenCV integration)
- Shot cooldown: 500ms between shots to prevent double-triggers

**Output per frame:**
```typescript
{
  position: Point2D | null,  // Brightest point in camera coordinates
  brightness: number,        // Peak brightness value (0–255)
  baseline: number,          // Rolling average brightness
  shotDetected: boolean,     // Whether this frame triggered a shot
  timestamp: number          // performance.now()
}
```

---

### CalibrationEngine (`src/engine/CalibrationEngine.ts`)

Maps camera coordinates to projector screen coordinates using a perspective homography.

**Why homography?**
The camera and projector view the wall from different positions and angles. A simple offset+scale can't handle perspective distortion. A 3x3 homography matrix handles translation, rotation, scaling, and perspective correction all at once.

**Calibration process:**
1. The app projects 4 bright markers at known screen positions (20% inset from each corner)
2. The user shoots each marker with the IR gun
3. The camera detects where each shot landed (camera coordinates)
4. We now have 4 pairs: `(camera_x, camera_y) → (screen_x, screen_y)`
5. The engine solves for the 3x3 homography matrix H using Direct Linear Transform (DLT)

**DLT algorithm:**
- For each point pair, we get 2 linear equations
- 4 points give 8 equations for 8 unknowns (9th element of H is set to 1)
- Solved via Gaussian elimination with partial pivoting

**Transform:**
```
[screen_x]       [h1 h2 h3]   [camera_x]
[screen_y] = 1/w [h4 h5 h6] × [camera_y]
[   w    ]       [h7 h8 h9]   [    1   ]
```

**Quality metric:** Reprojection error — average pixel distance between where the homography maps each calibration point vs where it should be. Under 5px is excellent, 5–15px is good, over 15px suggests recalibration.

**Manual offset:** After homography, an additional `(dx, dy)` offset can be nudged for fine-tuning.

---

### ScoringEngine (`src/engine/ScoringEngine.ts`)

Calculates shot scores from screen-pixel positions.

Since the target is projected on screen, the target center and radius are derived from `ProjectionConfig`:
- `targetCenter = (screenWidth/2 + offsetX, screenHeight/2 + offsetY)`
- `targetRadius = (shortSide × targetSizePercent) / 200`

For each shot, it computes the normalized distance from center (0 = bullseye, 1 = edge) and finds the highest-scoring ring the shot falls within.

Scoring rings are defined as `radiusPercent` (0–1) of the target radius. The engine iterates from highest score to lowest and returns the first ring the shot is inside.

---

## Screens

### MainMenu (`src/screens/MainMenu.tsx`)

Cinematic dark entry screen with:
- Three.js particle field background (`ParticleField` component)
- Animated scan line effect
- Four menu items with tactical styling and hover effects
- Each item has a color accent (cyan, orange, green, yellow)

### ShootingScreen (`src/screens/ShootingScreen.tsx`)

The main gameplay screen. Orchestrates:
- Camera capture via `useCamera` hook
- IR detection loop via `useDetectionLoop` hook
- Coordinate transform via `CalibrationEngine`
- Score calculation via `ScoringEngine`
- Projector sync (sends target config and hit events via IPC)

**Sub-components:**
- `TargetCanvas` — Full-screen Canvas2D rendering the target rings, aiming trace, shot markers, and live crosshair
- `HUDOverlay` — Tactical overlay with score, timer, shot log, status indicators, and control buttons
- `ShotFeedback` — Animated score popup with ring pulse and screen flash
- `CameraPreview` — Draggable floating camera feed with IR detection overlay

**Keyboard shortcuts:**
| Key | Action |
|-----|--------|
| P | Pause/resume |
| Space | Undo last shot |
| C | Clear all shots |
| V | Toggle camera preview |
| D | Toggle debug mode |
| Escape | Return to menu |

### CalibrationScreen (`src/screens/CalibrationScreen.tsx`)

Step-by-step calibration wizard with 5 steps:

1. **Setup** — Select projector display, open projector window
2. **Projecting** — 4 markers projected one at a time, user shoots each
3. **Testing** — Live mapping verification. Point IR gun around and see a real-time cursor on the projector following your aim. Shows reprojection error quality rating.
4. **Adjusting** — Manual offset nudge with directional pad buttons
5. **Complete** — Transition to shooting mode

The camera preview is available throughout calibration for debugging.

### ProjectorView (`src/screens/ProjectorView.tsx`)

Full-screen canvas rendered on the projector/second display. Receives commands from the control window via Electron IPC:

| Message | What it does |
|---------|-------------|
| `show-target` | Renders the target with scoring rings |
| `show-calibration-marker` | Shows a bright marker at a specific position |
| `show-calibration-marker` (index 99) | Shows a live cursor (used during calibration test) |
| `show-hit` | Adds a hit marker with score-based color |
| `clear` | Removes all hit markers |
| `blank` | Black screen |

Uses `requestAnimationFrame` for smooth rendering. State is managed via a ref (not React state) to avoid re-render overhead during rapid updates like the live cursor.

### ResultsScreen (`src/screens/ResultsScreen.tsx`)

Post-session debrief showing:
- Total score, average, best/worst shot
- Score distribution bar chart (0–10)
- Individual shot list with color-coded scores

### SettingsScreen (`src/screens/SettingsScreen.tsx`)

Configuration organized into 4 tabs:

| Tab | Settings |
|-----|----------|
| Camera | Device selection, capture resolution, image flip |
| Projection | Display selection, target size %, hit marker size, target offset |
| Detection | Mode (flash/dwell/hybrid), brightness threshold, spike multiplier, min brightness, blur radius, dwell radius/time |
| Target | Target library browser with one-click selection |

---

## Components

### TargetCanvas (`src/components/shooting/TargetCanvas.tsx`)

Canvas2D renderer that mirrors the projected target on the control screen. All coordinates are in projector screen space, scaled to fit the control window.

Renders in layers:
1. Target rings (from outside in, with score labels)
2. Center crosshair
3. Aiming trace (color shifts red→green as trace progresses)
4. Shot markers (color-coded by score with glow effect)
5. Live IR crosshair

### CameraPreview (`src/components/shooting/CameraPreview.tsx`)

Draggable floating window showing the raw camera feed with:
- Green crosshair on the detected IR point
- Coordinate readout
- Brightness bar at the bottom with:
  - Current brightness level (color changes: cyan → yellow → red)
  - Baseline indicator (cyan line)
  - Threshold indicator (orange line)

Toggle with V key. Drag to reposition.

### HUDOverlay (`src/components/shooting/HUDOverlay.tsx`)

Tactical heads-up display with:
- Top bar: target name, shot timer, score
- Left panel: scrollable shot log
- Right panel: tracking status, calibration status, IR level meter, series counter
- Bottom bar: control buttons with keyboard shortcut labels
- Corner bracket decorations

### ShotFeedback (`src/components/shooting/ShotFeedback.tsx`)

Animated feedback on shot detection:
- Screen edge flash (green for bullseye, orange otherwise)
- Score number floats up and fades out
- "BULLSEYE" text for score 10
- Expanding ring pulse effect

---

## Hooks

### useCamera (`src/hooks/useCamera.ts`)

Manages WebRTC camera access:
- Enumerates available video devices
- Starts/stops the camera stream with configurable device, resolution
- Provides a `videoRef` to attach to a hidden `<video>` element
- Reports `isReady` and `error` states

### useDetectionLoop (`src/hooks/useDetectionLoop.ts`)

Runs the IR detection loop:
- Creates an `IRDetector` instance when the video element is ready
- Runs `processFrame()` on every `requestAnimationFrame`
- Calls the `onFrame` callback with detection results
- Pauses when `isActive` is false
- Provides a `reset()` function to clear detection state

---

## State Management (`src/store/useAppStore.ts`)

Single Zustand store holding all application state:

| Category | State |
|----------|-------|
| Navigation | `currentScreen` |
| Camera | `cameraConfig`, `isCameraReady` |
| Projection | `projectionConfig` (display, resolution, target size, hit marker size, offset) |
| Detection | `detectionConfig`, `isTracking`, `currentBrightness`, `currentIRPosition` |
| Target | `activeTarget` (from target library) |
| Calibration | `calibrationProfile` (homography matrix, points, offset, error), `isCalibrated` |
| Session | `shots[]`, `shotsPerSeries`, `isPaused` |
| Profile | `activeProfile` |
| UI | `showDebug` |

---

## Database (`electron/database.ts`)

SQLite database stored in Electron's `userData` directory (`IR shooting training PoC.db`). Uses `better-sqlite3` for synchronous operations in the main process.

**Tables:**

| Table | Purpose |
|-------|---------|
| `profiles` | Shooter profiles (id, name, avatar, created_at) |
| `sessions` | Shooting sessions (id, profile_id, target config JSON, calibration JSON, mode, timestamps) |
| `shots` | Individual shots (id, session_id, camera coords, screen coords, score, timestamp, trace JSON) |
| `calibrations` | Saved calibration profiles (id, name, homography JSON, points JSON, offset, error) |

**Access pattern:** Renderer → IPC invoke → Main process → database.ts → SQLite

All database functions are exposed via IPC handlers in `main.ts` and bridged through `preload.ts` as `window.electronAPI.db*` methods.

---

## Electron IPC

### Window Controls
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `window:minimize` | Renderer → Main | Minimize window |
| `window:maximize` | Renderer → Main | Toggle maximize |
| `window:close` | Renderer → Main | Close window |
| `window:fullscreen` | Renderer → Main | Toggle fullscreen |

### Display Management
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `displays:getAll` | Renderer → Main | List all connected displays |

### Projector
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `projector:open` | Renderer → Main | Open projector window on specified display |
| `projector:close` | Renderer → Main | Close projector window |
| `projector:send` | Renderer → Main → Projector | Send command to projector window |
| `projector:message` | Main → Projector Renderer | Deliver command to projector |

### Database
All `db:*` channels follow the pattern `db:{table}:{operation}`. See the Database section above.

---

## Target Library (`src/data/targets.ts`)

9 built-in targets:

| ID | Name | Rings | Gauging |
|----|------|-------|---------|
| `standard-10ring` | Standard 10-Ring | 10 | Inward |
| `nsra-6yard` | NSRA 6 Yard Air Rifle | 10 | Inward |
| `nsra-10m` | NSRA 10m Air Rifle | 10 | Outward |
| `nsra-25yard` | NSRA 25 Yard Prone | 10 | Outward |
| `nsra-50yard` | NSRA 50 Yard Prone | 8 | Inward |
| `nsra-100yard` | NSRA 100 Yard Prone | 10 | Inward |
| `bullseye-simple` | Simple Bullseye (5 Ring) | 5 | Inward |
| `precision-small` | Precision (Tight Rings) | 10 | Inward |
| `speed-large` | Speed Shooting (Large Zones) | 4 | Inward |

Each target defines scoring rings as `radiusPercent` (0–1) of the total target radius. Rings are rendered digitally on the projector.

---

## Styling

The app uses a tactical/game HUD visual style:

- **Dark theme** with `#060a12` base and `#0a0e17` panels
- **Neon accent colors**: cyan (`#00f0ff`), orange (`#ff6b00`), red (`#ff2d55`), green (`#00ff88`), yellow (`#ffd600`)
- **Fonts**: Orbitron (HUD numbers), Rajdhani (UI text), JetBrains Mono (data)
- **Effects**: Scan line animation, neon glow shadows, corner bracket decorations, tactical grid background
- **Buttons**: Clipped polygon shape with neon border glow on hover

Custom CSS classes:
- `.tactical-grid` — Subtle grid background
- `.scan-line` — Animated horizontal scan line
- `.text-glow-*` — Neon text shadow effects
- `.hud-border` — Translucent panel with blur backdrop
- `.corner-brackets` — Decorative corner brackets via pseudo-elements
- `.btn-tactical` — Clipped polygon button with hover glow

---

## Build & Run

```bash
# Install dependencies
cd IR shooting training PoC-electron
npm install

# Development (Vite dev server + Electron)
npm run electron:dev

# Production build
npm run electron:build

# Type check only
npx tsc --noEmit
```

**Tech stack:**
| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 28 |
| Frontend | React 18 + TypeScript |
| Bundler | Vite 5 + vite-plugin-electron |
| 3D effects | Three.js + React Three Fiber |
| Animations | Framer Motion |
| Styling | Tailwind CSS 3 |
| State | Zustand |
| Database | better-sqlite3 |
| Camera | WebRTC (navigator.mediaDevices) |
