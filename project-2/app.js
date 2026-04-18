// --- GLOBALS ---
let srcPoints = [];
let homographyMatrix = null;
let isRecording = false;
let rallyData = []; // This stores everything: { p1: {x,y}, p2: {x,y}, timestamp }

let p1 = { x: 0, y: 0, color: "#00ffff", label: "P1" };
let p2 = { x: 0, y: 0, color: "#ff00ff", label: "P2" };

const courtWidth = 210, courtHeight = 320;
const cornerLabels = ["Front Left", "Front Right", "Back Right", "Back Left"];

// --- NAVIGATION & UI ---
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

function goToCamera() { 
    showScreen("camera"); 
    startCamera(); 
}

function goHome() { location.reload(); }

window.addEventListener("scroll", () => {
    const scroll = window.scrollY;
    const ball = document.querySelector(".ball");
    const cta = document.querySelector(".cta");
    if (ball) ball.style.transform = `translateY(${scroll * 0.8}px) rotate(${scroll}deg)`;
    if (scroll > 600 && cta) cta.classList.add("visible");
});

// --- INITIALIZE MEDIAPIPE ---
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
});

pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

// --- CAMERA & DATA COLLECTION ---
async function startCamera() {
    const video = document.getElementById("cameraFeed");
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");

    const camera = new Camera(video, {
        onFrame: async () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            await pose.send({ image: video });
        },
        width: 640,
        height: 480
    });
    camera.start();

    pose.onResults((results) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCalibration(ctx);

        if (results.poseLandmarks) {
            const landmarks = results.poseLandmarks;
            const midX = ((landmarks[27].x + landmarks[28].x) / 2) * canvas.width;
            const midY = ((landmarks[27].y + landmarks[28].y) / 2) * canvas.height;

            // Identity logic
            const distP1 = Math.hypot(midX - p1.x, midY - p1.y);
            const distP2 = Math.hypot(midX - p2.x, midY - p2.y);

            let activePlayer = distP1 < distP2 ? p1 : p2;
            activePlayer.x = midX;
            activePlayer.y = midY;

            // Visual feedback (Live)
            ctx.fillStyle = activePlayer.color;
            ctx.beginPath(); ctx.arc(midX, midY, 10, 0, Math.PI*2); ctx.fill();

            // STORE DATA
            if (isRecording && homographyMatrix) {
                const courtPos = mapToCourt(midX, midY);
                rallyData.push({
                    player: activePlayer.label,
                    x: courtPos.x,
                    y: courtPos.y,
                    color: activePlayer.color,
                    time: Date.now()
                });
                
                // Keep the "Live" preview running too
                drawLiveAnimation(courtPos.x, courtPos.y, activePlayer.color);
            }
        }
    });

    canvas.onclick = (e) => {
        if (srcPoints.length < 8) {
            const rect = canvas.getBoundingClientRect();
            srcPoints.push(
                (e.clientX - rect.left) * (canvas.width / rect.width),
                (e.clientY - rect.top) * (canvas.height / rect.height)
            );
            if (srcPoints.length === 8) {
                calculateHomography();
                document.getElementById("startTrackBtn").disabled = false;
            }
        }
    };
}

// --- RENDERING THE "PRODUCT" ---
function stopRecording() {
    isRecording = false;
    alert(`Rally Ended. Processing ${rallyData.length} data points...`);
    renderFinalProduct();
}

function renderFinalProduct() {
    const canvas = document.getElementById("courtCanvas");
    const ctx = canvas.getContext("2d");
    
    // Clear court for clean render
    ctx.clearRect(0, 0, courtWidth, courtHeight);
    
    // Draw all stored data points with a slight glow
    rallyData.forEach((point, i) => {
        setTimeout(() => {
            ctx.fillStyle = point.color;
            ctx.globalAlpha = 0.3; // Make it look like a heatmap
            ctx.beginPath();
            ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
            ctx.fill();
        }, i * 10); // "Replays" the rally quickly
    });
}

// --- MATH UTILS ---
function calculateHomography() {
    const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, srcPoints);
    const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, courtWidth, 0, courtWidth, courtHeight, 0, courtHeight]);
    homographyMatrix = cv.findHomography(srcCoords, dstCoords);
}

function mapToCourt(vx, vy) {
    const pt = cv.matFromArray(3, 1, cv.CV_64FC1, [vx, vy, 1]);
    const out = new cv.Mat();
    cv.gemm(homographyMatrix, pt, 1, new cv.Mat(), 0, out);
    return { x: out.data64F[0] / out.data64F[2], y: out.data64F[1] / out.data64F[2] };
}

function drawLiveAnimation(x, y, color) {
    const cCtx = document.getElementById("courtCanvas").getContext("2d");
    cCtx.fillStyle = "rgba(0,0,0,0.01)";
    cCtx.fillRect(0, 0, courtWidth, courtHeight);
    cCtx.fillStyle = color;
    cCtx.beginPath(); cCtx.arc(x, y, 3, 0, Math.PI * 2); cCtx.fill();
}

function drawCalibration(ctx) {
    for (let i = 0; i < srcPoints.length / 2; i++) {
        ctx.fillStyle = "gold";
        ctx.beginPath(); ctx.arc(srcPoints[i*2], srcPoints[i*2+1], 5, 0, Math.PI*2); ctx.fill();
    }
}

function startCapture() { 
    rallyData = []; // Reset for new rally
    isRecording = true; 
    showScreen("edit"); 
}
function stopRecording() { isRecording = false; renderFinalProduct(); }

function renderFinalProduct() {
    const canvas = document.getElementById("courtCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, courtWidth, courtHeight);
    rallyData.forEach((p, i) => {
        setTimeout(() => {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.2;
            ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
        }, i * 5);
    });
}

// Expose functions globally for HTML buttons
window.goToCamera = goToCamera;
window.goHome = goHome;
window.goToAbout = goToAbout;
window.goToPast = goToPast;
window.startCapture = startCapture;
window.stopRecording = stopRecording;