const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

// Player States
let players = [
    { id: 1, color: 'cyan', lastX: null, lastY: null },
    { id: 2, color: 'magenta', lastX: null, lastY: null }
];

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        // Get the "Feet" or "Midpoint" of the detected person
        // Landmark 27/28 are ankles
        const x = (results.poseLandmarks[27].x + results.poseLandmarks[28].x) / 2 * canvasElement.width;
        const y = (results.poseLandmarks[27].y + results.poseLandmarks[28].y) / 2 * canvasElement.height;

        // TRACKING LOGIC
        // If players are too close, we might need to "lock" the ID 
        // to the one that moved the least.
        let targetPlayer = identifyPlayer(x, y);
        
        drawPlayer(x, y, targetPlayer.color);
    }
    canvasCtx.restore();
}

function identifyPlayer(x, y) {
    // Calculate distance to both last known positions
    const d1 = Math.hypot(x - players[0].lastX, y - players[0].lastY);
    const d2 = Math.hypot(x - players[1].lastX, y - players[1].lastY);

    let chosen = (d1 < d2 || players[1].lastX === null) ? players[0] : players[1];
    
    chosen.lastX = x;
    chosen.lastY = y;
    return chosen;
}

function drawPlayer(x, y, color) {
    canvasCtx.fillStyle = color;
    canvasCtx.beginPath();
    canvasCtx.arc(x, y, 12, 0, 2 * Math.PI);
    canvasCtx.fill();
}

const pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
pose.setOptions({ modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
pose.onResults(onResults);

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await pose.send({image: videoElement});
  },
  width: 640,
  height: 480,
  facingMode: "environment" // FORCES BACK CAMERA
});
camera.start();