let srcPoints = [];
let homographyMatrix = null;
let isRecording = false;
const courtWidth = 210, courtHeight = 320;
const cornerLabels = ["Front Left", "Front Right", "Back Right", "Back Left"];

// --- NAVIGATION ---
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

function goToCamera() { showScreen("camera"); startCamera(); }
function goHome() { location.reload(); } // Simple way to reset state
function goToAbout() { alert("Squash movement visualizer project."); }

// --- SCROLL LOGIC ---
window.addEventListener("scroll", () => {
    const scroll = window.scrollY;
    const ball = document.querySelector(".ball");
    const cta = document.querySelector(".cta");

    if (ball) ball.style.transform = `translateY(${scroll * 0.8}px) rotate(${scroll}deg)`;
    if (scroll > 600) cta.classList.add("visible");
});

// --- AI POSE SETUP ---
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
});
pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5 });

// --- CAMERA & TRACKING ---
async function startCamera() {
    const video = document.getElementById("cameraFeed");
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");

    const camera = new Camera(video, {
        onFrame: async () => { 
            canvas.width = video.videoWidth; 
            canvas.height = video.videoHeight;
            await pose.send({image: video}); 
        },
        width: 640, height: 480
    });
    camera.start();

    // Click to set corners
    canvas.onclick = (e) => {
        if (srcPoints.length < 8) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            srcPoints.push((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
            if (srcPoints.length === 8) {
                calculateHomography();
                document.getElementById("startTrackBtn").disabled = false;
                document.getElementById("instruction").innerText = "Calibration Complete!";
            }
        }
    };

    pose.onResults((results) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCalibration(ctx);
        if (results.poseLandmarks) {
            const leftAnkle = results.poseLandmarks[27];
            const rightAnkle = results.poseLandmarks[28];
            const px = ((leftAnkle.x + rightAnkle.x) / 2) * canvas.width;
            const py = ((leftAnkle.y + rightAnkle.y) / 2) * canvas.height;

            // Visual Tell: Tracking Dot
            ctx.fillStyle = "#00ffff";
            ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI*2); ctx.fill();

            if (homographyMatrix && isRecording) {
                const pos = mapToCourt(px, py);
                drawLiveAnimation(pos.x, pos.y);
            }
        }
    });
}

// --- MATH & DRAWING ---
function drawCalibration(ctx) {
    for (let i = 0; i < srcPoints.length / 2; i++) {
        const x = srcPoints[i*2], y = srcPoints[i*2+1];
        ctx.fillStyle = "gold";
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = "white"; ctx.fillText(cornerLabels[i], x + 10, y);
    }
}

function calculateHomography() {
    let srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, srcPoints);
    let dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, courtWidth, 0, courtWidth, courtHeight, 0, courtHeight]);
    homographyMatrix = cv.findHomography(srcCoords, dstCoords);
}

function mapToCourt(vx, vy) {
    const pt = cv.matFromArray(3, 1, cv.CV_64FC1, [vx, vy, 1]);
    const out = new cv.Mat();
    cv.gemm(homographyMatrix, pt, 1, new cv.Mat(), 0, out);
    const x = out.data64F[0] / out.data64F[2];
    const y = out.data64F[1] / out.data64F[2];
    return { x, y };
}

function drawLiveAnimation(x, y) {
    const ctx = document.getElementById("courtCanvas").getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.fillRect(0,0,courtWidth,courtHeight);
    ctx.fillStyle = "gold";
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.fill();
}

function startCapture() { isRecording = true; showScreen("edit"); }
function resetCalibration() { srcPoints = []; homographyMatrix = null; document.getElementById("startTrackBtn").disabled = true; }