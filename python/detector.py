"""
IR Laser Shot Detection Service

OpenCV-based camera processing with WebSocket communication to Electron.
Replaces the browser-based WebRTC camera with proper UVC camera control.

Usage:
    python detector.py [--camera 0] [--port 8765]
"""

import cv2
import numpy as np
import asyncio
import websockets
import json
import time
import argparse
import threading
from collections import deque


class CameraPresets:
    """Camera parameter presets matching the Smokeless Range channels."""
    CALIBRATION = {
        'brightness': 0,
        'contrast': 32,
        'gain': 0,
        'saturation': 0,
        'hue': 0,
        'white_balance': 6500,
        'auto_exposure': 0,  # manual
    }
    TRACKING = {
        'brightness': -48,
        'contrast': 0,
        'gain': 20,
        'saturation': 128,
        'hue': 40,
        'white_balance': 6500,
        'auto_exposure': 0,  # manual
    }


class ShotDetector:
    """
    Full detection pipeline matching the original Smokeless Range system:
    1. Baseline subtraction
    2. Threshold
    3. Blob detection with centroid
    4. InstantShot / RecoilTracking modes
    5. Homography transform
    """

    def __init__(self):
        self.baseline = None
        self.baseline_frames = []
        self.is_capturing_baseline = False
        self.baseline_frames_needed = 30
        self.noise_floor = 0

        # Detection params
        self.enter_threshold = 40
        self.exit_threshold = 20
        self.min_blob_area = 1
        self.max_blob_area = 5000
        self.shot_cooldown = 0.2  # seconds

        # State
        self.last_shot_time = 0
        self.instant_shot_pending = False
        self.shot_mode = 'instant'  # 'instant' or 'recoil'

        # Recoil tracking
        self.line_tracking = False
        self.current_line = []
        self.inactive_frames = 0
        self.connected_distance = 50
        self.break_distance = 80
        self.inactive_limit = 2

        # Hot pixel mask
        self.hot_pixel_mask = None
        self.hot_pixel_candidates = {}
        self.hot_pixel_confirm_frames = 30
        self.hot_pixel_expiry = 5.0  # seconds

        # Baseline update
        self.pending_baseline_update = False
        self.baseline_update_delay = 0
        self.baseline_update_wait = 5

        # ROI
        self.roi = None  # (x, y, w, h)

        # Homography
        self.homography = None

    def start_baseline_capture(self):
        self.is_capturing_baseline = True
        self.baseline_frames = []
        self.baseline = None

    def has_baseline(self):
        return self.baseline is not None

    def set_roi(self, x, y, w, h):
        self.roi = (int(x), int(y), int(w), int(h))

    def set_homography(self, matrix):
        """Set 3x3 homography matrix (9 numbers, row-major)."""
        self.homography = np.array(matrix).reshape(3, 3)

    def camera_to_screen(self, cx, cy):
        """Transform camera coords to screen coords via homography."""
        if self.homography is None:
            return cx, cy
        pt = np.array([[[cx, cy]]], dtype=np.float64)
        transformed = cv2.perspectiveTransform(pt, self.homography)
        return float(transformed[0][0][0]), float(transformed[0][0][1])

    def process_frame(self, frame):
        """
        Process a camera frame. Returns dict with detection results.
        """
        now = time.time()

        # Convert to grayscale
        if len(frame.shape) == 3:
            # Use max of channels (works with IR filter on any channel)
            gray = np.max(frame, axis=2).astype(np.uint8)
        else:
            gray = frame

        h, w = gray.shape

        # Apply ROI
        if self.roi:
            rx, ry, rw, rh = self.roi
            rx = max(0, min(rx, w))
            ry = max(0, min(ry, h))
            rw = min(rw, w - rx)
            rh = min(rh, h - ry)
            roi_gray = gray[ry:ry+rh, rx:rx+rw]
        else:
            rx, ry = 0, 0
            roi_gray = gray

        rh_actual, rw_actual = roi_gray.shape

        # ── Baseline capture ──
        if self.is_capturing_baseline:
            self.baseline_frames.append(roi_gray.copy().astype(np.float32))
            if len(self.baseline_frames) >= self.baseline_frames_needed:
                # Average frames, excluding spikes
                stack = np.stack(self.baseline_frames)
                frame_maxes = stack.max(axis=(1, 2))
                median_max = np.median(frame_maxes)
                good_mask = frame_maxes <= median_max + 30
                if good_mask.sum() < 5:
                    good_mask[:] = True
                good_frames = stack[good_mask]
                self.baseline = good_frames.mean(axis=0).astype(np.uint8)

                # Noise floor from std dev
                std = good_frames.std(axis=0)
                self.noise_floor = min(20, int(np.ceil(std.max() * 2)))

                self.is_capturing_baseline = False
                self.baseline_frames = []
                print(f'[detector] Baseline captured ({good_mask.sum()}/{len(stack)} frames). Noise floor: {self.noise_floor}')

            return {'type': 'baseline_progress', 'progress': len(self.baseline_frames) / self.baseline_frames_needed}

        if self.baseline is None:
            return {'type': 'no_baseline'}

        # ── Rolling baseline update ──
        if self.pending_baseline_update and not self.line_tracking:
            self.baseline_update_delay += 1
            if self.baseline_update_delay >= self.baseline_update_wait:
                alpha = 0.3
                diff_check = roi_gray.astype(np.int16) - self.baseline.astype(np.int16)
                mask = np.abs(diff_check) < 30
                self.baseline[mask] = (
                    self.baseline[mask].astype(np.float32) * (1 - alpha) +
                    roi_gray[mask].astype(np.float32) * alpha
                ).astype(np.uint8)
                self.pending_baseline_update = False
                self.baseline_update_delay = 0

        # ── Baseline subtraction ──
        diff = cv2.subtract(roi_gray, self.baseline)

        # ── Hot pixel masking ──
        if self.hot_pixel_mask is not None and self.hot_pixel_mask.shape == diff.shape:
            diff[self.hot_pixel_mask > 0] = 0

        # ── Find peak ──
        min_val, max_diff, min_loc, max_loc = cv2.minMaxLoc(diff)
        max_diff = int(max_diff)
        peak_x, peak_y = max_loc  # in ROI coords

        # Raw peak (before baseline subtraction)
        raw_peak = int(roi_gray[peak_y, peak_x]) if max_diff > 0 else 0

        # ── Effective threshold ──
        effective_threshold = max(self.enter_threshold, self.noise_floor)

        # ── Blob detection with sub-pixel centroid ──
        position = None
        blob_area = 0

        if max_diff > effective_threshold:
            # Threshold the diff image
            _, binary = cv2.threshold(diff, effective_threshold, 255, cv2.THRESH_BINARY)

            # Find contours
            contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            if contours:
                # Pick the largest contour
                best = max(contours, key=cv2.contourArea)
                blob_area = int(cv2.contourArea(best))

                if self.min_blob_area <= blob_area <= self.max_blob_area:
                    # Weighted centroid using moments
                    M = cv2.moments(best)
                    if M['m00'] > 0:
                        cx = M['m10'] / M['m00']
                        cy = M['m01'] / M['m00']
                    else:
                        cx, cy = float(peak_x), float(peak_y)

                    # Convert ROI coords to full frame coords
                    position = (cx + rx, cy + ry)

        # ── Hot pixel tracking ──
        if max_diff > 0 and position:
            key = f'{int(position[0])},{int(position[1])}'
            matched = False
            for k, (count, t) in list(self.hot_pixel_candidates.items()):
                kx, ky = map(int, k.split(','))
                dist = np.sqrt((position[0] - kx)**2 + (position[1] - ky)**2)
                if dist < 8:
                    self.hot_pixel_candidates[k] = (count + 1, now)
                    if count + 1 >= self.hot_pixel_confirm_frames:
                        # Confirmed hot pixel — add to mask
                        if self.hot_pixel_mask is None:
                            self.hot_pixel_mask = np.zeros((rh_actual, rw_actual), dtype=np.uint8)
                        local_x = int(position[0] - rx)
                        local_y = int(position[1] - ry)
                        cv2.circle(self.hot_pixel_mask, (local_x, local_y), 8, 255, -1)
                        del self.hot_pixel_candidates[k]
                    matched = True
                    break
            if not matched:
                self.hot_pixel_candidates[key] = (1, now)

            # Expire old candidates
            for k in list(self.hot_pixel_candidates.keys()):
                if now - self.hot_pixel_candidates[k][1] > self.hot_pixel_expiry:
                    del self.hot_pixel_candidates[k]

        # ── Shot detection ──
        shot_detected = False
        shot_x, shot_y = 0.0, 0.0

        if now - self.last_shot_time > self.shot_cooldown:
            if self.shot_mode == 'instant':
                # InstantShot: register on first frame above threshold
                if position and max_diff >= effective_threshold:
                    if not self.instant_shot_pending:
                        self.instant_shot_pending = True
                        shot_x, shot_y = position
                        shot_detected = True
                        self.last_shot_time = now
                else:
                    self.instant_shot_pending = False

            else:
                # Recoil tracking mode
                if position and max_diff >= self.exit_threshold:
                    if not self.line_tracking:
                        if max_diff >= self.enter_threshold:
                            self.line_tracking = True
                            self.current_line = [position]
                            self.inactive_frames = 0
                    else:
                        last = self.current_line[-1]
                        dist = np.sqrt((position[0] - last[0])**2 + (position[1] - last[1])**2)
                        if dist <= self.connected_distance:
                            self.current_line.append(position)
                        elif dist <= self.break_distance:
                            self.current_line.append(position)
                        else:
                            result = self._finalize_line()
                            if result:
                                shot_x, shot_y = result
                                shot_detected = True
                                self.last_shot_time = now
                            self.line_tracking = True
                            self.current_line = [position]
                        self.inactive_frames = 0
                elif self.line_tracking:
                    self.inactive_frames += 1
                    if self.inactive_frames >= self.inactive_limit:
                        result = self._finalize_line()
                        if result:
                            shot_x, shot_y = result
                            shot_detected = True
                            self.last_shot_time = now

        # Transform to screen coords
        screen_x, screen_y = 0.0, 0.0
        if shot_detected:
            screen_x, screen_y = self.camera_to_screen(shot_x, shot_y)
            self.pending_baseline_update = True
            self.baseline_update_delay = 0

        return {
            'type': 'frame',
            'shot_detected': shot_detected,
            'screen_x': screen_x,
            'screen_y': screen_y,
            'camera_x': shot_x if shot_detected else 0,
            'camera_y': shot_y if shot_detected else 0,
            'peak_diff': max_diff,
            'raw_peak': raw_peak,
            'noise_floor': self.noise_floor,
            'threshold': effective_threshold,
            'has_baseline': True,
            'blob_area': blob_area,
        }

    def _finalize_line(self):
        self.line_tracking = False
        line = self.current_line
        self.current_line = []
        if not line:
            return None
        # Use first point (pre-recoil aim)
        return line[0]

    def reset(self):
        self.instant_shot_pending = False
        self.line_tracking = False
        self.current_line = []
        self.inactive_frames = 0
        self.last_shot_time = 0
        self.pending_baseline_update = False
        self.baseline_update_delay = 0


class CameraManager:
    """Manages the USB camera with OpenCV."""

    def __init__(self, camera_index=0):
        self.camera_index = camera_index
        self.cap = None
        self.frame = None
        self.running = False
        self.lock = threading.Lock()
        self.fps = 0
        self.frame_count = 0
        self.last_fps_time = time.time()

    def open(self, width=640, height=480, fps=60):
        self.cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            # Try without DirectShow
            self.cap = cv2.VideoCapture(self.camera_index)

        if not self.cap.isOpened():
            raise RuntimeError(f'Cannot open camera {self.camera_index}')

        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap.set(cv2.CAP_PROP_FPS, fps)

        actual_w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        actual_fps = self.cap.get(cv2.CAP_PROP_FPS)
        print(f'[camera] Opened: {actual_w}x{actual_h} @ {actual_fps}fps')
        return actual_w, actual_h, actual_fps

    def apply_preset(self, preset_name):
        if not self.cap:
            return
        preset = CameraPresets.CALIBRATION if preset_name == 'calibration' else CameraPresets.TRACKING
        self.cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, preset['auto_exposure'])
        self.cap.set(cv2.CAP_PROP_BRIGHTNESS, preset['brightness'])
        self.cap.set(cv2.CAP_PROP_CONTRAST, preset['contrast'])
        self.cap.set(cv2.CAP_PROP_GAIN, preset['gain'])
        self.cap.set(cv2.CAP_PROP_SATURATION, preset['saturation'])
        self.cap.set(cv2.CAP_PROP_HUE, preset['hue'])
        self.cap.set(cv2.CAP_PROP_WB_TEMPERATURE, preset['white_balance'])
        print(f'[camera] Applied {preset_name} preset')

    def set_exposure(self, value):
        if self.cap:
            self.cap.set(cv2.CAP_PROP_EXPOSURE, value)

    def start_capture(self):
        self.running = True
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _capture_loop(self):
        while self.running and self.cap and self.cap.isOpened():
            ret, frame = self.cap.read()
            if ret:
                with self.lock:
                    self.frame = frame
                self.frame_count += 1
                now = time.time()
                if now - self.last_fps_time >= 2.0:
                    self.fps = self.frame_count / (now - self.last_fps_time)
                    self.frame_count = 0
                    self.last_fps_time = now

    def get_frame(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    def close(self):
        self.running = False
        if self.cap:
            self.cap.release()


# ── WebSocket Server ──

camera = CameraManager()
detector = ShotDetector()
clients = set()
detection_active = False


async def handle_client(websocket):
    global detection_active
    clients.add(websocket)
    print(f'[ws] Client connected ({len(clients)} total)')

    try:
        async for message in websocket:
            data = json.loads(message)
            cmd = data.get('cmd')

            if cmd == 'open_camera':
                idx = data.get('camera_index', 0)
                w = data.get('width', 640)
                h = data.get('height', 480)
                fps = data.get('fps', 60)
                try:
                    aw, ah, afps = camera.open(idx, w, h, fps)
                    camera.start_capture()
                    await websocket.send(json.dumps({
                        'type': 'camera_opened',
                        'width': aw, 'height': ah, 'fps': afps,
                    }))
                except Exception as e:
                    await websocket.send(json.dumps({
                        'type': 'error', 'message': str(e),
                    }))

            elif cmd == 'set_preset':
                camera.apply_preset(data.get('preset', 'calibration'))
                await websocket.send(json.dumps({'type': 'preset_applied'}))

            elif cmd == 'set_exposure':
                camera.set_exposure(data.get('value', -6))
                await websocket.send(json.dumps({'type': 'exposure_set'}))

            elif cmd == 'auto_adjust_exposure':
                # Auto-adjust exposure for calibration
                result = auto_adjust_exposure(data.get('target_brightness', 40))
                await websocket.send(json.dumps(result))

            elif cmd == 'capture_baseline':
                detector.start_baseline_capture()
                await websocket.send(json.dumps({'type': 'baseline_started'}))

            elif cmd == 'set_homography':
                detector.set_homography(data.get('matrix', []))
                await websocket.send(json.dumps({'type': 'homography_set'}))

            elif cmd == 'set_roi':
                detector.set_roi(data['x'], data['y'], data['w'], data['h'])
                await websocket.send(json.dumps({'type': 'roi_set'}))

            elif cmd == 'start_detection':
                detection_active = True
                detector.reset()
                await websocket.send(json.dumps({'type': 'detection_started'}))

            elif cmd == 'stop_detection':
                detection_active = False
                await websocket.send(json.dumps({'type': 'detection_stopped'}))

            elif cmd == 'get_brightest':
                # Get brightest point in current frame (for calibration)
                frame = camera.get_frame()
                if frame is not None:
                    gray = np.max(frame, axis=2) if len(frame.shape) == 3 else frame
                    min_v, max_v, min_l, max_l = cv2.minMaxLoc(gray)
                    await websocket.send(json.dumps({
                        'type': 'brightest',
                        'x': int(max_l[0]), 'y': int(max_l[1]),
                        'brightness': int(max_v),
                    }))
                else:
                    await websocket.send(json.dumps({
                        'type': 'brightest', 'x': 0, 'y': 0, 'brightness': 0,
                    }))

            elif cmd == 'set_mode':
                detector.shot_mode = data.get('mode', 'instant')
                await websocket.send(json.dumps({'type': 'mode_set', 'mode': detector.shot_mode}))

            elif cmd == 'ping':
                await websocket.send(json.dumps({'type': 'pong', 'fps': camera.fps}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)
        print(f'[ws] Client disconnected ({len(clients)} total)')


def auto_adjust_exposure(target_brightness=40):
    """Auto-adjust camera exposure until peak brightness is near target."""
    exposures = [-3, -4, -5, -6, -7, -8, -9, -10, -11, -12]
    for exp in exposures:
        camera.set_exposure(exp)
        time.sleep(0.4)
        frame = camera.get_frame()
        if frame is None:
            continue
        gray = np.max(frame, axis=2) if len(frame.shape) == 3 else frame
        peak = int(gray.max())
        print(f'[camera] Exposure {exp}: peak={peak}')
        if peak <= target_brightness + 20 and peak >= 10:
            return {'type': 'exposure_adjusted', 'exposure': exp, 'peak': peak}
    return {'type': 'exposure_adjusted', 'exposure': exposures[-1], 'peak': 0}


async def detection_loop():
    """Main detection loop — processes frames and broadcasts results."""
    global detection_active
    while True:
        if detection_active and clients:
            frame = camera.get_frame()
            if frame is not None:
                result = detector.process_frame(frame)
                if result.get('shot_detected'):
                    msg = json.dumps(result)
                    for client in list(clients):
                        try:
                            await client.send(msg)
                        except:
                            pass
        await asyncio.sleep(0.008)  # ~120Hz polling


async def status_loop():
    """Periodic status broadcast."""
    while True:
        if clients and detection_active:
            frame = camera.get_frame()
            if frame is not None:
                result = detector.process_frame(frame)
                # Only send periodic status, not every frame
                if result.get('type') == 'frame':
                    msg = json.dumps({
                        'type': 'status',
                        'peak_diff': result['peak_diff'],
                        'raw_peak': result['raw_peak'],
                        'noise_floor': result['noise_floor'],
                        'threshold': result['threshold'],
                        'has_baseline': result['has_baseline'],
                        'fps': round(camera.fps, 1),
                    })
                    for client in list(clients):
                        try:
                            await client.send(msg)
                        except:
                            pass
        await asyncio.sleep(2.0)


async def main(port=8765):
    print(f'[detector] Starting WebSocket server on port {port}')
    async with websockets.serve(handle_client, 'localhost', port):
        await asyncio.gather(
            detection_loop(),
            status_loop(),
            asyncio.Future(),  # run forever
        )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='IR Laser Shot Detection Service')
    parser.add_argument('--camera', type=int, default=0, help='Camera index')
    parser.add_argument('--port', type=int, default=8765, help='WebSocket port')
    args = parser.parse_args()

    camera = CameraManager(args.camera)
    asyncio.run(main(args.port))
