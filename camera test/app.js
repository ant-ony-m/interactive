const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const resetBtn = document.getElementById('reset-btn');

let calibrationPoints = [];
let homographyMatrix = null;

// 1. Setup Camera with Fallback
async function setupCamera() {
    const constraints = {
        video: {
            facingMode: { ideal: "environment" }, // Try back camera
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    };

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
    } catch (e) {
        console.warn("Back camera not found, trying front...");
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = fallbackStream;
    }
}

// 2. Calibration Taps
canvas.addEventListener('pointerdown', (e) => {
    if (calibrationPoints.length < 4) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        calibrationPoints.push({ x, y });
        drawCalibration();
        
        if (calibrationPoints.length === 4) {
            calculateHomography();
            status.innerText = "Tracking Active!";
        }
    }
});

function drawCalibration() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#00ffcc";
    calibrationPoints.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`Corner ${i+1}`, p.x + 10, p.y);
    });
}

resetBtn.onclick = () => {
    calibrationPoints = [];
    homographyMatrix = null;
    status.innerText = "Tap 4 corners of the court...";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
};

// 3. Simple Homography Projection Math
function calculateHomography() {
    // Destination coordinates: normalized 0-1 for the mini-map
    const dst = [{x:0, y:0}, {x:1, y:0}, {x:1, y:1}, {x:0, y:1}];
    const src = calibrationPoints;
    
    // In a real production app, use a library like 'numeric.js' or 'OpenCV.js'
    // to solve the linear system Ah = 0. For now, we flag homography as "ready".
    homographyMatrix = true; 
}

function projectPoint(px, py) {
    if (!homographyMatrix) return {x: 0.5, y: 0.5};

    // Simplified Bilinear Interpolation as a proxy for Homography
    // (Actual homography requires a 3x3 matrix multiplication)
    const p1 = calibrationPoints[0], p2 = calibrationPoints[1];
    const p3 = calibrationPoints[2], p4 = calibrationPoints[3];

    // Percentage across the tapped quad
    let xPerc = (px - p1.x) / (p2.x - p1.x);
    let yPerc = (py - p1.y) / (p4.y - p1.y);

    return {
        x: Math.max(0, Math.min(100, xPerc * 100)),
        y: Math.max(0, Math.min(100, yPerc * 100))
    };
}

// 4. MediaPipe Pose Detection
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({ modelComplexity: 1, minDetectionConfidence: 0.5 });

pose.onResults((results) => {
    if (!results.poseLandmarks) return;

    // Get "Feet" position (average of heels)
    const landmarks = results.poseLandmarks;
    const lHeel = landmarks[29], rHeel = landmarks[30];
    const footX = ((lHeel.x + rHeel.x) / 2) * canvas.width;
    const footY = ((lHeel.y + rHeel.y) / 2) * canvas.height;

    // Update Mini-map
    if (homographyMatrix) {
        const coords = projectPoint(footX, footY);
        const marker = document.getElementById('p1-marker');
        marker.style.left = `${coords.x}%`;
        marker.style.top = `${coords.y}%`;
    }
});

// Start Camera loop
const camera = new Camera(video, {
    onFrame: async () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        await pose.send({image: video});
    }
});

setupCamera().then(() => camera.start());